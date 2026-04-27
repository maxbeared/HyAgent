/**
 * LSP Tool - Tool for interacting with Language Server Protocol
 *
 * Provides functions for:
 * - Getting hover information
 * - Finding definitions
 * - Finding references
 * - Getting document symbols
 * - Searching workspace symbols
 */

import { Effect } from 'effect'
import { z } from 'zod'
import type { LSPService } from './index.js'

// ============================================================================
// Input Schemas
// ============================================================================

export const LSPHoverInput = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number (0-indexed)'),
  character: z.number().describe('Character position (0-indexed)')
})

export const LSPDefinitionInput = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number (0-indexed)'),
  character: z.number().describe('Character position (0-indexed)')
})

export const LSPReferencesInput = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number (0-indexed)'),
  character: z.number().describe('Character position (0-indexed)')
})

export const LSPDocumentSymbolsInput = z.object({
  file: z.string().describe('File path')
})

export const LSPWorkspaceSymbolInput = z.object({
  query: z.string().describe('Search query for workspace symbols')
})

export const LSPDiagnosticsInput = z.object({
  file: z.string().optional().describe('File path (optional, if not provided returns all diagnostics)')
})

export type LSPHoverArgs = z.infer<typeof LSPHoverInput>
export type LSPDefinitionArgs = z.infer<typeof LSPDefinitionInput>
export type LSPReferencesArgs = z.infer<typeof LSPReferencesInput>
export type LSPDocumentSymbolsArgs = z.infer<typeof LSPDocumentSymbolsInput>
export type LSPWorkspaceSymbolArgs = z.infer<typeof LSPWorkspaceSymbolInput>
export type LSPDiagnosticsArgs = z.infer<typeof LSPDiagnosticsInput>

// ============================================================================
// Tool Functions
// ============================================================================

type HoverResult = { contents?: unknown; range?: unknown }
type LocationResult = { uri?: string; targetUri?: string; range?: { start: { line: number; character: number } }; targetRange?: { start: { line: number; character: number } }; location?: { uri?: string; range?: { start: { line: number; character: number } } } }
type SymbolResult = { name: string; kind: number; location?: { uri?: string; range?: { start: { line: number } } } }

/**
 * Execute hover request
 */
export function lspHover(lsp: LSPService, args: LSPHoverArgs): Effect.Effect<string> {
  const hoverArgs = args as { file: string; line: number; character: number }
  return Effect.flatMap(
    lsp.hover(hoverArgs),
    (result: unknown) => {
      if (!result) {
        return Effect.succeed('No hover information available')
      }
      const hr = result as HoverResult
      const contents = hr.contents
      const text = Array.isArray(contents)
        ? contents.map((c) => (c as { value?: string }).value ?? String(c)).join('\n')
        : String(contents)
      return Effect.succeed(text)
    }
  )
}

/**
 * Execute definition request
 */
export function lspDefinition(lsp: LSPService, args: LSPDefinitionArgs): Effect.Effect<string> {
  const defArgs = args as { file: string; line: number; character: number }
  return Effect.flatMap(
    lsp.definition(defArgs),
    (results: unknown) => {
      const locs = results as LocationResult[]
      if (locs.length === 0) {
        return Effect.succeed('No definition found')
      }
      const output = locs.map((r) => {
        const uri = r.uri ?? r.targetUri
        const range = r.range ?? r.targetRange
        const line = range?.start?.line ?? 0
        const char = range?.start?.character ?? 0
        return `${uri}:${line + 1}:${char + 1}`
      }).join('\n')
      return Effect.succeed(output)
    }
  )
}

/**
 * Execute references request
 */
export function lspReferences(lsp: LSPService, args: LSPReferencesArgs): Effect.Effect<string> {
  const refArgs = args as { file: string; line: number; character: number }
  return Effect.flatMap(
    lsp.references(refArgs),
    (results: unknown) => {
      const locs = results as LocationResult[]
      if (locs.length === 0) {
        return Effect.succeed('No references found')
      }
      const output = locs.map((r) => {
        const uri = r.uri ?? r.location?.uri
        const range = r.range ?? r.location?.range
        const line = range?.start?.line ?? 0
        const char = range?.start?.character ?? 0
        return `${uri}:${line + 1}:${char + 1}`
      }).join('\n')
      return Effect.succeed(output)
    }
  )
}

/**
 * Execute document symbols request
 */
export function lspDocumentSymbols(lsp: LSPService, args: LSPDocumentSymbolsArgs): Effect.Effect<string> {
  const uri = `file://${args.file.replace(/\\/g, '/')}`
  return Effect.flatMap(
    lsp.documentSymbol(uri),
    (results: unknown) => {
      const syms = results as SymbolResult[]
      if (syms.length === 0) {
        return Effect.succeed('No symbols found in document')
      }
      const symbolKindNames: Record<number, string> = {
        1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package',
        5: 'Class', 6: 'Method', 7: 'Property', 8: 'Field',
        9: 'Constructor', 10: 'Enum', 11: 'Interface', 12: 'Function',
        13: 'Variable', 14: 'Constant', 23: 'Struct', 24: 'Event'
      }
      const output = syms.map((s) => {
        const kind = symbolKindNames[s.kind] ?? `Kind(${s.kind})`
        return `${kind}: ${s.name}`
      }).join('\n')
      return Effect.succeed(output)
    }
  )
}

/**
 * Execute workspace symbol search
 */
export function lspWorkspaceSymbol(lsp: LSPService, args: LSPWorkspaceSymbolArgs): Effect.Effect<string> {
  return Effect.flatMap(
    lsp.workspaceSymbol(args.query),
    (results: unknown) => {
      const syms = results as SymbolResult[]
      if (syms.length === 0) {
        return Effect.succeed('No symbols found matching query')
      }
      const symbolKindNames: Record<number, string> = {
        1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package',
        5: 'Class', 6: 'Method', 7: 'Property', 8: 'Field',
        9: 'Constructor', 10: 'Enum', 11: 'Interface', 12: 'Function',
        13: 'Variable', 14: 'Constant', 23: 'Struct', 24: 'Event'
      }
      const output = syms.map((s) => {
        const kind = symbolKindNames[s.kind] ?? `Kind(${s.kind})`
        const uri = s.location?.uri
        const line = s.location?.range?.start?.line ?? 0
        return `${kind}: ${s.name} (${uri}:${line + 1})`
      }).join('\n')
      return Effect.succeed(output)
    }
  )
}

/**
 * Get diagnostics
 */
export function lspDiagnostics(lsp: LSPService, args: LSPDiagnosticsArgs): Effect.Effect<string> {
  return Effect.flatMap(
    lsp.diagnostics(),
    (allDiagnostics: Record<string, unknown[]>) => {
      const { LSPDiagnostic } = require('./index.js')

      if (args.file) {
        const normalizedPath = args.file.replace(/\\/g, '/')
        const fileDiags = (allDiagnostics[normalizedPath] || allDiagnostics[args.file] || []) as unknown[]

        if (fileDiags.length === 0) {
          return Effect.succeed('No diagnostics for file')
        }

        return Effect.succeed(LSPDiagnostic.report(args.file, fileDiags as any))
      }

      const files = Object.keys(allDiagnostics)
      if (files.length === 0) {
        return Effect.succeed('No diagnostics')
      }

      const output = files.map((f) => LSPDiagnostic.report(f, allDiagnostics[f] as any)).join('\n')
      return Effect.succeed(output)
    }
  )
}
