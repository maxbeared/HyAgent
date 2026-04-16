/**
 * Edit Tool - 带路径安全检查的文件编辑工具
 *
 * 参考来源:
 * - opencode/packages/opencode/src/tool/edit.ts
 * - Anthropic-Leaked-Source-Code/tools/FileEditTool/
 */

import { Effect } from 'effect'
import { z } from 'zod'
import type { ToolDef, ToolContext } from './tool.js'
import { EditInput } from './tool.js'
import { validatePathSafety, isProtectedPath } from '../permission/pathValidation.js'

// ============================================================================
// Types
// ============================================================================

interface EditMetadata {
  title: string
  path: string
  oldLength: number
  newLength: number
  [key: string]: unknown
}

// ============================================================================
// Edit Tool
// ============================================================================

/**
 * EditTool - 安全增强的文件编辑工具
 *
 * 安全检查:
 * - 路径安全检查
 * - 保护路径阻止 (.git/, .claude/, shell configs)
 */
export const EditTool: ToolDef<typeof EditInput, EditMetadata> = {
  id: 'edit',
  description: 'Edit a file by replacing text',
  parameters: EditInput,

  checkPermissions(input, _ctx) {
    return Effect.gen(function* () {
      const path = input.path

      // Path safety check
      const safety = validatePathSafety(path)

      if (!safety.isSafe) {
        return {
          behavior: 'deny' as const,
          reason: safety.reason,
        }
      }

      // Check for protected paths (来自Claude Code)
      if (isProtectedPath(path)) {
        return {
          behavior: 'deny' as const,
          reason: `Protected path: ${path}`,
        }
      }

      return { behavior: 'allow' as const }
    })
  },

  isConcurrencySafe() {
    return false // Edits should not happen concurrently on same file
  },

  execute(input, _ctx) {
    return Effect.gen(function* () {
      const path = input.path
      const { oldString, newString } = input

      // Read file
      const originalContent = yield* Effect.promise(() =>
        import('fs/promises').then((fs) => fs.readFile(path, 'utf-8'))
      )

      // Replace
      if (!originalContent.includes(oldString)) {
        return {
          title: 'Edit Failed',
          metadata: {
            title: 'Edit Failed',
            path,
            oldLength: oldString.length,
            newLength: newString.length,
          } as EditMetadata,
          output: `Could not find text to replace:\n${oldString}`,
        }
      }

      const newContent = originalContent.replace(oldString, newString)

      // Write back
      yield* Effect.promise(() =>
        import('fs/promises').then((fs) => fs.writeFile(path, newContent, 'utf-8'))
      )

      return {
        title: `Edit: ${path}`,
        metadata: {
          title: 'Edit',
          path,
          oldLength: oldString.length,
          newLength: newString.length,
        } as EditMetadata,
        output: `Successfully edited ${path}`,
      }
    })
  },
}
