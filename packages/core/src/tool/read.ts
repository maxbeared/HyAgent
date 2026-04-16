/**
 * Read Tool - 带路径安全检查的文件读取工具
 *
 * 参考来源:
 * - opencode/packages/opencode/src/tool/read.ts
 * - Anthropic-Leaked-Source-Code/tools/FileReadTool/FileReadTool.ts
 */

import { Effect } from 'effect'
import { z } from 'zod'
import type { ToolDef, ToolContext } from './tool.js'
import { ReadInput } from './tool.js'
import { validatePathSafety } from '../permission/pathValidation.js'

// ============================================================================
// Types
// ============================================================================

interface ReadMetadata {
  title: string
  path: string
  lines: number
  sizeBytes: number
  [key: string]: unknown
}

// ============================================================================
// Read Tool
// ============================================================================

/**
 * ReadTool - 安全增强的文件读取工具
 *
 * 安全检查:
 * - UNC路径阻止 (防止NTLM泄露)
 * - 设备路径阻止 (/dev/*)
 * - 路径遍历检测
 * - 敏感路径保护
 */
export const ReadTool: ToolDef<typeof ReadInput, ReadMetadata> = {
  id: 'read',
  description: 'Read contents of a file',
  parameters: ReadInput,

  checkPermissions(input, _ctx) {
    return Effect.gen(function* () {
      const path = input.path

      // Path safety check (来自Claude Code)
      const safety = validatePathSafety(path)

      if (!safety.isSafe) {
        return {
          behavior: 'deny' as const,
          reason: safety.reason,
        }
      }

      return { behavior: 'allow' as const }
    })
  },

  isConcurrencySafe() {
    return true // Multiple reads can happen concurrently
  },

  execute(input, _ctx) {
    return Effect.gen(function* () {
      const path = input.path
      const limit = input.limit ?? 1000
      const offset = input.offset ?? 0

      // Read file using Effect
      const content = yield* Effect.promise(() =>
        import('fs/promises').then((fs) =>
          fs.readFile(path, 'utf-8')
        )
      )

      // Apply offset and limit
      const lines = content.split('\n')
      const totalLines = lines.length
      const slicedLines = lines.slice(offset, offset + limit)
      const resultContent = slicedLines.join('\n')

      return {
        title: `Read: ${path}`,
        metadata: {
          title: 'Read',
          path,
          lines: slicedLines.length,
          sizeBytes: Buffer.byteLength(resultContent, 'utf-8'),
        } as ReadMetadata,
        output: resultContent + (offset + limit < totalLines ? `\n... (${totalLines - offset - limit} more lines)` : ''),
      }
    })
  },
}
