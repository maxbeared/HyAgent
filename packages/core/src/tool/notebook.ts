/**
 * Notebook Tool - 让 Agent 能够编辑 Jupyter Notebooks
 *
 * 支持读取、创建和编辑 .ipynb 文件的单元格。
 */

import { z } from 'zod'
import { Effect } from 'effect'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { ToolDef } from './tool.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Notebook cell types
 */
export type NotebookCellType = 'code' | 'markdown' | 'raw'

/**
 * Notebook cell
 */
export interface NotebookCell {
  cell_type: NotebookCellType
  metadata?: Record<string, unknown>
  source: string | string[]
  outputs?: unknown[]
  execution_count?: number | null
}

/**
 * Notebook format
 */
export interface Notebook {
  nbformat: number
  nbformat_minor: number
  metadata?: Record<string, unknown>
  cells: NotebookCell[]
}

/**
 * Notebook tool input schema
 */
export const NotebookInputSchema = z.object({
  path: z.string().describe('Path to the notebook file (.ipynb)'),
  operation: z.enum(['read', 'add_cell', 'update_cell', 'delete_cell']).describe('Operation to perform'),
  cell_index: z.number().optional().describe('Cell index (0-based) for update/delete operations'),
  cell_type: z.enum(['code', 'markdown', 'raw']).optional().describe('Cell type for new cells'),
  source: z.string().optional().describe('Cell source content'),
  output: z.string().optional().describe('Expected output for code cells'),
})

export type NotebookInput = z.infer<typeof NotebookInputSchema>

/**
 * Notebook metadata
 */
export type NotebookMetadata = {
  path: string
  operation: string
  cellCount?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a notebook file
 */
export async function parseNotebook(path: string): Promise<Notebook> {
  const content = await readFile(path, 'utf-8')
  return JSON.parse(content) as Notebook
}

/**
 * Write a notebook file
 */
export async function writeNotebook(path: string, notebook: Notebook): Promise<void> {
  await writeFile(path, JSON.stringify(notebook, null, 2), 'utf-8')
}

/**
 * Create an empty notebook
 */
export function createEmptyNotebook(): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.9.0',
      },
    },
    cells: [],
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Create the notebook tool
 */
export function createNotebookTool(): ToolDef<typeof NotebookInputSchema, NotebookMetadata> {
  return {
    id: 'notebook',
    description: 'Read or edit Jupyter notebooks (.ipynb files). Supports reading notebooks, adding/updating/deleting cells.',
    parameters: NotebookInputSchema,

    isConcurrencySafe() {
      return false // File operations should be sequential
    },

    execute(input) {
      return Effect.gen(function* () {
        const startTime = Date.now()
        let notebook: Notebook
        let output = ''

        // Load or create notebook
        if (existsSync(input.path)) {
          notebook = yield* Effect.promise(() => parseNotebook(input.path))
        } else if (input.operation === 'read') {
          return {
            title: 'Notebook Error',
            metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
            output: `Notebook not found: ${input.path}`,
          }
        } else {
          notebook = createEmptyNotebook()
        }

        switch (input.operation) {
          case 'read': {
            const cells = notebook.cells.map((cell, i) => {
              const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source
              return `[Cell ${i}] ${cell.cell_type}:\n${source.slice(0, 200)}${source.length > 200 ? '...' : ''}`
            })
            output = `Notebook: ${input.path}\nCells: ${notebook.cells.length}\n\n${cells.join('\n\n')}`
            break
          }

          case 'add_cell': {
            if (!input.source) {
              return {
                title: 'Notebook Error',
                metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
                output: 'source is required for add_cell operation',
              }
            }

            const newCell: NotebookCell = {
              cell_type: input.cell_type || 'code',
              metadata: {},
              source: input.source,
              execution_count: null,
              outputs: [],
            }

            notebook.cells.push(newCell)
            yield* Effect.promise(() => writeNotebook(input.path, notebook))

            output = `Cell added at index ${notebook.cells.length - 1}\nCell type: ${newCell.cell_type}\nSource: ${input.source.slice(0, 100)}${input.source.length > 100 ? '...' : ''}`
            break
          }

          case 'update_cell': {
            if (input.cell_index === undefined) {
              return {
                title: 'Notebook Error',
                metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
                output: 'cell_index is required for update_cell operation',
              }
            }

            if (input.cell_index < 0 || input.cell_index >= notebook.cells.length) {
              return {
                title: 'Notebook Error',
                metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
                output: `Cell index out of range: ${input.cell_index} (0-${notebook.cells.length - 1})`,
              }
            }

            const cell = notebook.cells[input.cell_index]
            if (input.source) {
              cell.source = input.source
            }
            if (input.cell_type) {
              cell.cell_type = input.cell_type
            }

            yield* Effect.promise(() => writeNotebook(input.path, notebook))

            output = `Cell ${input.cell_index} updated\nCell type: ${cell.cell_type}\nSource: ${(Array.isArray(cell.source) ? cell.source.join('') : cell.source).slice(0, 100)}...`
            break
          }

          case 'delete_cell': {
            if (input.cell_index === undefined) {
              return {
                title: 'Notebook Error',
                metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
                output: 'cell_index is required for delete_cell operation',
              }
            }

            if (input.cell_index < 0 || input.cell_index >= notebook.cells.length) {
              return {
                title: 'Notebook Error',
                metadata: { path: input.path, operation: input.operation } as NotebookMetadata,
                output: `Cell index out of range: ${input.cell_index} (0-${notebook.cells.length - 1})`,
              }
            }

            const deleted = notebook.cells.splice(input.cell_index, 1)
            yield* Effect.promise(() => writeNotebook(input.path, notebook))

            output = `Cell ${input.cell_index} deleted\nDeleted: ${deleted[0].cell_type} - ${(Array.isArray(deleted[0].source) ? deleted[0].source.join('') : deleted[0].source).slice(0, 50)}...`
            break
          }
        }

        return {
          title: `Notebook: ${input.operation}`,
          metadata: { path: input.path, operation: input.operation, cellCount: notebook.cells.length } as NotebookMetadata,
          output,
        }
      })
    },
  }
}
