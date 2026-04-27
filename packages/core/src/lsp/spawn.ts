/**
 * LSP Server spawning utilities
 *
 * 参考来源: opencode/packages/opencode/src/lsp/launch.ts
 */

import { spawn as nodeSpawn, ChildProcessWithoutNullStreams } from 'child_process'

export type ChildProcess = ChildProcessWithoutNullStreams

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string>
  stdin?: 'pipe' | 'ignore' | 'inherit'
  stdout?: 'pipe' | 'ignore' | 'inherit'
  stderr?: 'pipe' | 'ignore' | 'inherit'
}

/**
 * Spawn an LSP server process
 */
export function spawn(
  cmd: string,
  args: string[],
  opts?: SpawnOptions
): ChildProcess {
  const proc = nodeSpawn(cmd, args, {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...process.env, ...opts?.env },
    stdio: [opts?.stdin ?? 'pipe', opts?.stdout ?? 'pipe', opts?.stderr ?? 'pipe'],
  })

  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    throw new Error('Process output not available')
  }

  return proc as ChildProcess
}
