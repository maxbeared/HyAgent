/**
 * LSP - Language Server Protocol support
 *
 * This module provides LSP client functionality for connecting to
 * language servers (TypeScript, Python, Rust, etc.)
 *
 * 参考来源: opencode/packages/opencode/src/lsp/index.ts
 */

import { Effect, Layer, Context } from 'effect'
import { z } from 'zod'
import { pathToFileURL, fileURLToPath } from 'url'
import path from 'path'
import { createLSPClient, type LSPServerHandle, type LSPClientInfo } from './client.js'
import { spawn } from './spawn.js'

// ============================================================================
// Types
// ============================================================================

export const LSPPosition = z.object({
  line: z.number(),
  character: z.number()
})

export const LSPRange = z.object({
  start: LSPPosition,
  end: LSPPosition
})

export const LSPDocumentSymbol = z.object({
  name: z.string(),
  detail: z.string().optional(),
  kind: z.number(),
  range: LSPRange,
  selectionRange: LSPRange
})

export const LSPSymbol = z.object({
  name: z.string(),
  kind: z.number(),
  location: z.object({
    uri: z.string(),
    range: LSPRange
  })
})

export type LSPPosition = z.infer<typeof LSPPosition>
export type LSPRange = z.infer<typeof LSPRange>
export type LSPDocumentSymbol = z.infer<typeof LSPDocumentSymbol>
export type LSPSymbol = z.infer<typeof LSPSymbol>

// LSP Server definition
export interface LSPServer {
  id: string
  name: string
  extensions: string[]
  root?: (file: string) => Promise<string>
  spawn: (root: string) => Promise<LSPServerHandle>
  initialization?: Record<string, unknown>
}

// ============================================================================
// Built-in LSP Servers (20+ languages supported)
// ============================================================================

export const TypeScriptServer: LSPServer = {
  id: 'typescript',
  name: 'TypeScript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  async spawn(root: string) {
    const tsserverPath = await findTypeScriptServer()
    return {
      process: spawn('node', [tsserverPath], { cwd: root }) as unknown as LSPServerHandle['process'],
      initialization: {
        preferences: {
          includeInlayParameterNameHints: 'all',
          includePackageJsonAutoImport: 'on'
        }
      }
    }
  }
}

export const PythonServer: LSPServer = {
  id: 'python',
  name: 'Python',
  extensions: ['.py'],
  async spawn(root: string) {
    return {
      process: spawn('python', ['-m', 'pyright-langserver', '--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const PyrightServer: LSPServer = {
  id: 'pyright',
  name: 'Pyright',
  extensions: ['.py'],
  async spawn(root: string) {
    return {
      process: spawn('npx', ['pyright-langserver', '--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const RustServer: LSPServer = {
  id: 'rust',
  name: 'Rust Analyzer',
  extensions: ['.rs'],
  async spawn(root: string) {
    return {
      process: spawn('rust-analyzer', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const GoServer: LSPServer = {
  id: 'go',
  name: 'Go',
  extensions: ['.go'],
  async spawn(root: string) {
    return {
      process: spawn('gopls', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const JavaServer: LSPServer = {
  id: 'java',
  name: 'Java',
  extensions: ['.java'],
  async spawn(root: string) {
    return {
      process: spawn('jdtls', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const CSharpServer: LSPServer = {
  id: 'csharp',
  name: 'C#',
  extensions: ['.cs'],
  async spawn(root: string) {
    return {
      process: spawn('omnisharp', ['--languageserver'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const CppServer: LSPServer = {
  id: 'cpp',
  name: 'C++',
  extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh'],
  async spawn(root: string) {
    return {
      process: spawn('clangd', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const VueServer: LSPServer = {
  id: 'vue',
  name: 'Vue',
  extensions: ['.vue'],
  async spawn(root: string) {
    return {
      process: spawn('volar-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const SvelteServer: LSPServer = {
  id: 'svelte',
  name: 'Svelte',
  extensions: ['.svelte'],
  async spawn(root: string) {
    return {
      process: spawn('svelte-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const HtmlServer: LSPServer = {
  id: 'html',
  name: 'HTML',
  extensions: ['.html', '.htm'],
  async spawn(root: string) {
    return {
      process: spawn('vscode-html-languageserver', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const CssServer: LSPServer = {
  id: 'css',
  name: 'CSS',
  extensions: ['.css', '.scss', '.sass', '.less'],
  async spawn(root: string) {
    return {
      process: spawn('vscode-css-languageserver', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const JsonServer: LSPServer = {
  id: 'json',
  name: 'JSON',
  extensions: ['.json', '.jsonc', '.tsbuildinfo'],
  async spawn(root: string) {
    return {
      process: spawn('vscode-json-languageserver', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const MarkdownServer: LSPServer = {
  id: 'markdown',
  name: 'Markdown',
  extensions: ['.md', '.markdown', '.mdown', '.mkd'],
  async spawn(root: string) {
    return {
      process: spawn('marksman', ['server'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const YamlServer: LSPServer = {
  id: 'yaml',
  name: 'YAML',
  extensions: ['.yaml', '.yml'],
  async spawn(root: string) {
    return {
      process: spawn('yaml-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const DockerServer: LSPServer = {
  id: 'docker',
  name: 'Docker',
  extensions: ['.dockerfile', 'Dockerfile'],
  async spawn(root: string) {
    return {
      process: spawn('docker-langserver', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const SqlServer: LSPServer = {
  id: 'sql',
  name: 'SQL',
  extensions: ['.sql', '.duckdb'],
  async spawn(root: string) {
    return {
      process: spawn('sql-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const RubyServer: LSPServer = {
  id: 'ruby',
  name: 'Ruby',
  extensions: ['.rb', '.rake', '.gemspec', '.ru'],
  async spawn(root: string) {
    return {
      process: spawn('solargraph', ['server'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const PhpServer: LSPServer = {
  id: 'php',
  name: 'PHP',
  extensions: ['.php'],
  async spawn(root: string) {
    return {
      process: spawn('phpactor', ['language-server'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const SwiftServer: LSPServer = {
  id: 'swift',
  name: 'Swift',
  extensions: ['.swift'],
  async spawn(root: string) {
    return {
      process: spawn('sourcekit-lsp', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const ZigServer: LSPServer = {
  id: 'zig',
  name: 'Zig',
  extensions: ['.zig'],
  async spawn(root: string) {
    return {
      process: spawn('zls', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const LuaServer: LSPServer = {
  id: 'lua',
  name: 'Lua',
  extensions: ['.lua'],
  async spawn(root: string) {
    return {
      process: spawn('lua-language-server', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const DartServer: LSPServer = {
  id: 'dart',
  name: 'Dart',
  extensions: ['.dart'],
  async spawn(root: string) {
    return {
      process: spawn('dart', ['language-server'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

// ============================================================================
// Document & Markup Language Servers
// ============================================================================

export const LatexServer: LSPServer = {
  id: 'latex',
  name: 'LaTeX',
  extensions: ['.tex', '.latex', '.sty', '.cls'],
  async spawn(root: string) {
    return {
      process: spawn('texlab', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const RServer: LSPServer = {
  id: 'r',
  name: 'R',
  extensions: ['.r', '.R', '.rmd', '.rnw'],
  async spawn(root: string) {
    return {
      process: spawn('r-languageserver', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const JuliaServer: LSPServer = {
  id: 'julia',
  name: 'Julia',
  extensions: ['.jl'],
  async spawn(root: string) {
    return {
      process: spawn('julia', ['-e', 'using LanguageServer; LanguageServer.runserver()'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const HaskellServer: LSPServer = {
  id: 'haskell',
  name: 'Haskell',
  extensions: ['.hs', '.lhs', '.hsig'],
  async spawn(root: string) {
    return {
      process: spawn('haskell-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const ScalaServer: LSPServer = {
  id: 'scala',
  name: 'Scala',
  extensions: ['.scala', '.sc'],
  async spawn(root: string) {
    return {
      process: spawn('metals', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const KotlinServer: LSPServer = {
  id: 'kotlin',
  name: 'Kotlin',
  extensions: ['.kt', '.kts'],
  async spawn(root: string) {
    return {
      process: spawn('kotlin-language-server', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const ElixirServer: LSPServer = {
  id: 'elixir',
  name: 'Elixir',
  extensions: ['.ex', '.exs', '.eex', '.leex'],
  async spawn(root: string) {
    return {
      process: spawn('elixir-ls', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const ErlangServer: LSPServer = {
  id: 'erlang',
  name: 'Erlang',
  extensions: ['.erl', '.hrl', '.es'],
  async spawn(root: string) {
    return {
      process: spawn('erlang_ls', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const ClojureServer: LSPServer = {
  id: 'clojure',
  name: 'Clojure',
  extensions: ['.clj', '.cljs', '.cljc', '.edn'],
  async spawn(root: string) {
    return {
      process: spawn('clojure-lsp', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const FortranServer: LSPServer = {
  id: 'fortran',
  name: 'Fortran',
  extensions: ['.f', '.f90', '.f95', '.for'],
  async spawn(root: string) {
    return {
      process: spawn('fortran-ls', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const PascalServer: LSPServer = {
  id: 'pascal',
  name: 'Pascal',
  extensions: ['.pas', '.pp', '.inc', '.dpr'],
  async spawn(root: string) {
    return {
      process: spawn('pasls', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const OCamlServer: LSPServer = {
  id: 'ocaml',
  name: 'OCaml',
  extensions: ['.ml', '.mli', '.re', '.rei'],
  async spawn(root: string) {
    return {
      process: spawn('ocamllsp', [], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const GraphQLServer: LSPServer = {
  id: 'graphql',
  name: 'GraphQL',
  extensions: ['.graphql', '.gql', '.graphqls'],
  async spawn(root: string) {
    return {
      process: spawn('graphql-lsp', ['server', '--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const TOMLServer: LSPServer = {
  id: 'toml',
  name: 'TOML',
  extensions: ['.toml'],
  async spawn(root: string) {
    return {
      process: spawn('taplo', ['lsp', 'stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const XMLServer: LSPServer = {
  id: 'xml',
  name: 'XML',
  extensions: ['.xml', '.xsl', '.xslt', '.dtd', '.svg'],
  async spawn(root: string) {
    return {
      process: spawn('xmllint', ['--shell'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const TerraformServer: LSPServer = {
  id: 'terraform',
  name: 'Terraform',
  extensions: ['.tf', '.tfvars', '.hcl'],
  async spawn(root: string) {
    return {
      process: spawn('terraform-ls', ['serve'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const KubernetesServer: LSPServer = {
  id: 'kubernetes',
  name: 'Kubernetes',
  extensions: ['k8s.yaml', 'k8s.yml', 'kubernetes.yaml', 'kubernetes.yml'],
  async spawn(root: string) {
    return {
      process: spawn('yaml-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const DiffServer: LSPServer = {
  id: 'diff',
  name: 'Diff',
  extensions: ['.diff', '.patch'],
  async spawn(_root: string) {
    // Diff files are typically read-only, no language server needed
    return {
      process: spawn('true', [], {}) as unknown as LSPServerHandle['process']
    }
  }
}

export const PropertiesServer: LSPServer = {
  id: 'properties',
  name: 'Properties',
  extensions: ['.properties', '.env', '.ini', '.cfg', '.conf'],
  async spawn(root: string) {
    return {
      process: spawn('properties-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const MakefileServer: LSPServer = {
  id: 'makefile',
  name: 'Makefile',
  extensions: ['Makefile', 'makefile', '.mk'],
  async spawn(root: string) {
    return {
      process: spawn('makefile-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const NinjaServer: LSPServer = {
  id: 'ninja',
  name: 'Ninja',
  extensions: ['.ninja'],
  async spawn(root: string) {
    return {
      process: spawn('ninja-language-server', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const VerilogServer: LSPServer = {
  id: 'verilog',
  name: 'Verilog',
  extensions: ['.v', '.vh', '.sv', '.svh'],
  async spawn(root: string) {
    return {
      process: spawn('verible-ls', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

export const VhdlServer: LSPServer = {
  id: 'vhdl',
  name: 'VHDL',
  extensions: ['.vhd', '.vhdl'],
  async spawn(root: string) {
    return {
      process: spawn('vhdl-ls', ['--stdio'], { cwd: root }) as unknown as LSPServerHandle['process']
    }
  }
}

// ============================================================================
// LSP Service
// ============================================================================

interface LSPState {
  clients: LSPClientInfo[]
  servers: Record<string, LSPServer>
  broken: Set<string>
  spawning: Map<string, Promise<LSPClientInfo | undefined>>
}

export interface LSPService {
  init(): Effect.Effect<void>
  status(): Effect.Effect<LSPStatus[]>
  hasClients(file: string): Effect.Effect<boolean>
  touchFile(input: string, waitForDiagnostics?: boolean): Effect.Effect<void>
  diagnostics(): Effect.Effect<Record<string, import('vscode-languageserver-protocol').Diagnostic[]>>
  hover(input: { file: string; line: number; character: number }): Effect.Effect<unknown>
  definition(input: { file: string; line: number; character: number }): Effect.Effect<unknown[]>
  references(input: { file: string; line: number; character: number }): Effect.Effect<unknown[]>
  documentSymbol(uri: string): Effect.Effect<(LSPDocumentSymbol | LSPSymbol)[]>
  workspaceSymbol(query: string): Effect.Effect<LSPSymbol[]>
}

export const LSPServiceTag = Context.GenericTag<LSPService>('@hyagent/lsp')

export const LSPStatus = z.object({
  id: z.string(),
  name: z.string(),
  root: z.string(),
  status: z.union([z.literal('connected'), z.literal('error')])
})

export type LSPStatus = z.infer<typeof LSPStatus>

// ============================================================================
// Implementation
// ============================================================================

async function findTypeScriptServer(): Promise<string> {
  const { execSync } = await import('child_process')
  try {
    const tscPath = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const tsserverPath = path.join(tscPath, 'typescript', 'lib', 'tsserverlib.js')
    const { existsSync } = await import('fs')
    if (existsSync(tsserverPath)) {
      return tsserverPath
    }
  } catch {}
  return require.resolve('typescript/bin/tsserver')
}

function getClientsForFile(state: LSPState, file: string): LSPClientInfo[] {
  const extension = path.extname(file) || file
  const result: LSPClientInfo[] = []

  for (const client of state.clients) {
    const server = state.servers[client.serverID]
    if (server && server.extensions.includes(extension)) {
      result.push(client)
    }
  }

  return result
}

export const LSPServiceImpl = Effect.gen(function* () {
  const state: LSPState = {
    clients: [],
    servers: {
      // Programming Languages
      [TypeScriptServer.id]: TypeScriptServer,
      [PythonServer.id]: PythonServer,
      [PyrightServer.id]: PyrightServer,
      [RustServer.id]: RustServer,
      [GoServer.id]: GoServer,
      [JavaServer.id]: JavaServer,
      [CSharpServer.id]: CSharpServer,
      [CppServer.id]: CppServer,
      [VueServer.id]: VueServer,
      [SvelteServer.id]: SvelteServer,
      [SwiftServer.id]: SwiftServer,
      [ZigServer.id]: ZigServer,
      [LuaServer.id]: LuaServer,
      [DartServer.id]: DartServer,
      [ScalaServer.id]: ScalaServer,
      [KotlinServer.id]: KotlinServer,
      [ElixirServer.id]: ElixirServer,
      [ErlangServer.id]: ErlangServer,
      [ClojureServer.id]: ClojureServer,
      [FortranServer.id]: FortranServer,
      [PascalServer.id]: PascalServer,
      [OCamlServer.id]: OCamlServer,
      [VerilogServer.id]: VerilogServer,
      [VhdlServer.id]: VhdlServer,
      [HaskellServer.id]: HaskellServer,
      [JuliaServer.id]: JuliaServer,
      [RServer.id]: RServer,
      [RubyServer.id]: RubyServer,
      [PhpServer.id]: PhpServer,

      // Markup & Document Formats
      [HtmlServer.id]: HtmlServer,
      [CssServer.id]: CssServer,
      [JsonServer.id]: JsonServer,
      [MarkdownServer.id]: MarkdownServer,
      [YamlServer.id]: YamlServer,
      [XMLServer.id]: XMLServer,
      [LatexServer.id]: LatexServer,
      [GraphQLServer.id]: GraphQLServer,
      [TOMLServer.id]: TOMLServer,

      // DevOps & Config
      [DockerServer.id]: DockerServer,
      [TerraformServer.id]: TerraformServer,
      [KubernetesServer.id]: KubernetesServer,
      [PropertiesServer.id]: PropertiesServer,
      [MakefileServer.id]: MakefileServer,
      [NinjaServer.id]: NinjaServer,

      // Data & Query
      [SqlServer.id]: SqlServer,

      // Misc
      [DiffServer.id]: DiffServer,
    },
    broken: new Set(),
    spawning: new Map()
  }

  const init = Effect.fn('LSP.init')(function* () {
    // Nothing to initialize yet
  })

  const status = Effect.fn('LSP.status')(function* () {
    const result: LSPStatus[] = []
    for (const client of state.clients) {
      result.push({
        id: client.serverID,
        name: state.servers[client.serverID]?.name ?? client.serverID,
        root: client.root,
        status: 'connected'
      })
    }
    return result
  })

  const hasClients = Effect.fn('LSP.hasClients')(function* (file: string) {
    const result = getClientsForFile(state, file).length > 0
    return result
  })

  const touchFile = Effect.fn('LSP.touchFile')(function* (input: string, waitForDiagnostics?: boolean) {
    const clients = getClientsForFile(state, input)

    yield* Effect.promise(() =>
      Promise.all(
        clients.map(async (client) => {
          const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: input }) : Promise.resolve()
          await client.notify.open({ path: input })
          return wait
        })
      )
    )
  })

  const diagnostics = Effect.fn('LSP.diagnostics')(function* () {
    const results: Record<string, import('vscode-languageserver-protocol').Diagnostic[]> = {}
    for (const client of state.clients) {
      for (const [p, diags] of client.diagnostics.entries()) {
        const arr = results[p] || []
        arr.push(...diags)
        results[p] = arr
      }
    }
    return results
  })

  const hover = Effect.fn('LSP.hover')(function* (input: { file: string; line: number; character: number }) {
    const clients = getClientsForFile(state, input.file)
    const results = yield* Effect.promise(() =>
      Promise.all(
        clients.map((client) =>
          client.connection.sendRequest('textDocument/hover', {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character }
          }).catch(() => null)
        )
      )
    )
    return results.flat().filter(Boolean)[0] ?? null
  })

  const definition = Effect.fn('LSP.definition')(function* (input: { file: string; line: number; character: number }) {
    const clients = getClientsForFile(state, input.file)
    const results = yield* Effect.promise(() =>
      Promise.all(
        clients.map((client) =>
          client.connection.sendRequest('textDocument/definition', {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character }
          }).catch(() => null)
        )
      )
    )
    return results.flat().filter(Boolean)
  })

  const references = Effect.fn('LSP.references')(function* (input: { file: string; line: number; character: number }) {
    const clients = getClientsForFile(state, input.file)
    const results = yield* Effect.promise(() =>
      Promise.all(
        clients.map((client) =>
          client.connection.sendRequest('textDocument/references', {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true }
          }).catch(() => [])
        )
      )
    )
    return results.flat().filter(Boolean)
  })

  const documentSymbol = Effect.fn('LSP.documentSymbol')(function* (uri: string) {
    const file = fileURLToPath(uri)
    const clients = getClientsForFile(state, file)
    const results = yield* Effect.promise(() =>
      Promise.all(
        clients.map((client) =>
          client.connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } }).catch(() => [])
        )
      )
    )
    return (results.flat() as (LSPDocumentSymbol | LSPSymbol)[]).filter(Boolean)
  })

  const workspaceSymbol = Effect.fn('LSP.workspaceSymbol')(function* (query: string) {
    const results = yield* Effect.promise(() =>
      Promise.all(
        state.clients.map((client) =>
          client.connection
            .sendRequest('workspace/symbol', { query })
            .then((result: unknown) => (result as LSPSymbol[]).filter((x) => [1, 3, 5, 6, 12, 13, 14].includes(x.kind)))
            .then((result: unknown) => (result as LSPSymbol[]).slice(0, 10))
            .catch(() => [])
        )
      )
    )
    return results.flat() as LSPSymbol[]
  })

  return LSPServiceTag.of({
    init,
    status,
    hasClients,
    touchFile,
    diagnostics,
    hover,
    definition,
    references,
    documentSymbol,
    workspaceSymbol
  })
})

export const LSPLayer = Layer.effect(LSPServiceTag, LSPServiceImpl)

// ============================================================================
// Diagnostic formatting
// ============================================================================

export namespace LSPDiagnostic {
  const MAX_PER_FILE = 20

  const severityMap: Record<number, string> = {
    1: 'ERROR',
    2: 'WARN',
    3: 'INFO',
    4: 'HINT'
  }

  export function pretty(diagnostic: import('vscode-languageserver-protocol').Diagnostic): string {
    const severity = severityMap[diagnostic.severity || 1]
    const line = diagnostic.range.start.line + 1
    const col = diagnostic.range.start.character + 1
    return `${severity} [${line}:${col}] ${diagnostic.message}`
  }

  export function report(file: string, issues: import('vscode-languageserver-protocol').Diagnostic[]): string {
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length === 0) return ''
    const limited = errors.slice(0, MAX_PER_FILE)
    const more = errors.length - MAX_PER_FILE
    const suffix = more > 0 ? `\n... and ${more} more` : ''
    return `<diagnostics file="${file}">\n${limited.map(pretty).join('\n')}${suffix}\n</diagnostics>`
  }
}

// Re-export types
export type { LSPServerHandle, LSPClientInfo }
