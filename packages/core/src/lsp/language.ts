/**
 * Language extensions to LSP language ID mapping
 *
 * 参考来源: opencode/packages/opencode/src/lsp/language.ts
 */

export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  // Programming Languages
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Data & Config
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.xsl': 'xml',
  '.xslt': 'xml',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.properties': 'properties',
  '.env': 'properties',

  // Documentation
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdown': 'markdown',
  '.mdwn': 'markdown',
  '.mkd': 'markdown',
  '.tex': 'latex',
  '.latex': 'latex',
  '.sty': 'latex',
  '.cls': 'latex',

  // Shell & Scripts
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.fish': 'shellscript',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.bat': 'bat',
  '.cmd': 'bat',

  // Functional & Academic
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsx': 'fsharp',
  '.lua': 'lua',
  '.dart': 'dart',
  '.R': 'r',
  '.r': 'r',
  '.rmd': 'r',
  '.jl': 'julia',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.edn': 'clojure',

  // Systems
  '.zig': 'zig',
  '.nim': 'nim',
  '.nix': 'nix',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.re': 'reason',
  '.rei': 'reason',

  // Build & DevOps
  '.cmake': 'cmake',
  '.makefile': 'makefile',
  'makefile': 'makefile',
  '.mk': 'makefile',
  '.dockerfile': 'dockerfile',
  'Dockerfile': 'dockerfile',
  '.tf': 'hcl',
  '.tfvars': 'hcl',
  '.hcl': 'hcl',

  // Query & Data
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.duckdb': 'sql',

  // Office Documents (text extraction supported)
  '.docx': 'wordprocessingml',
  '.xlsx': 'spreadsheetml',
  '.pptx': 'presentationml',
  '.odt': 'odf',
  '.ods': 'odf',
  '.odp': 'odf',

  // Image & Media (metadata extraction)
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image',
  '.ico': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.heic': 'image',
  '.avif': 'image',

  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.wma': 'audio',

  // Video
  '.mp4': 'video',
  '.mkv': 'video',
  '.avi': 'video',
  '.mov': 'video',
  '.wmv': 'video',
  '.flv': 'video',
  '.webm': 'video',
  '.m4v': 'video',

  // Archives
  '.zip': 'archive',
  '.tar': 'archive',
  '.gz': 'archive',
  '.bz2': 'archive',
  '.xz': 'archive',
  '.7z': 'archive',
  '.rar': 'archive',

  // Fonts
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.eot': 'font',

  // 3D & CAD
  '.stl': '3d',
  '.obj': '3d',
  '.fbx': '3d',
  '.gltf': '3d',
  '.glb': '3d',
  '.step': '3d',
  '.iges': '3d',
  '.dwg': 'cad',
} as const

/**
 * Get language ID from file extension
 */
export function getLanguageId(extension: string): string {
  return LANGUAGE_EXTENSIONS[extension.toLowerCase()] ?? 'plaintext'
}

/**
 * Check if a file type is supported for text extraction
 */
export function isTextBasedFile(extension: string): boolean {
  const langId = getLanguageId(extension)
  return langId !== 'plaintext' && !['image', 'audio', 'video', 'archive', 'font', '3d', 'cad'].includes(langId)
}

/**
 * Check if a file type supports metadata extraction
 */
export function isMetadataExtractable(extension: string): boolean {
  const langId = getLanguageId(extension)
  return ['image', 'audio', 'video', 'font', '3d'].includes(langId)
}

/**
 * Check if a file is an Office document
 */
export function isOfficeDocument(extension: string): boolean {
  const ext = extension.toLowerCase()
  return ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'].includes(ext)
}
