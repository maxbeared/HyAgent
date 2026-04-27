/**
 * Document Tools - Handle Office files, multimedia, and binary file processing
 *
 * These tools provide:
 * - Office document text extraction (docx, xlsx, pptx, odt, ods, odp)
 * - Image/video/audio metadata extraction
 * - File format detection
 */

import { Effect } from 'effect'
import { z } from 'zod'
import { readFile, stat, open } from 'fs/promises'
import { basename, extname } from 'path'
import { isOfficeDocument, getLanguageId } from '../lsp/language.js'

// ============================================================================
// Input Schemas
// ============================================================================

export const ExtractTextInput = z.object({
  file: z.string().describe('Path to the file to extract text from'),
})

export const GetMetadataInput = z.object({
  file: z.string().describe('Path to the file to get metadata from'),
})

export const DetectFormatInput = z.object({
  file: z.string().describe('Path to the file to detect format'),
})

// ============================================================================
// Types
// ============================================================================

export interface DocumentMetadata {
  file: string
  size: number
  extension: string
  languageId: string
  isOfficeDocument: boolean
  isBinary: boolean
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detect file format from magic bytes
 */
async function detectFileFormat(filePath: string): Promise<string> {
  const buffer = Buffer.alloc(8)
  const fd = await open(filePath, 'r')
  try {
    const { bytesRead } = await fd.read(buffer, 0, 8, 0)
    if (bytesRead < 4) return 'unknown'

    // Check magic bytes
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return 'zip' // Office docs, jars, etc.
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return 'png'
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpeg'
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'gif'
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return 'bmp'
    }
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return 'gzip'
    }

    return 'unknown'
  } finally {
    await fd.close()
  }
}

/**
 * Extract text from Office documents (docx, xlsx, pptx)
 * Office documents are ZIP archives with XML content
 */
async function extractOfficeText(filePath: string, extension: string): Promise<string> {
  const JSZip = (await import('jszip')).default

  const data = await readFile(filePath)
  const zip = await JSZip.loadAsync(data)

  const results: string[] = []

  if (extension === '.docx' || extension === '.odt') {
    const docXml = await zip.file('word/document.xml')?.async('string')
    if (docXml) {
      results.push(extractTextFromXml(docXml))
    }
  } else if (extension === '.xlsx' || extension === '.ods') {
    const sheetFiles = Object.keys(zip.file).filter(f => f.startsWith('xl/worksheets/'))
    for (const sheetFile of sheetFiles) {
      const sheetXml = await zip.file(sheetFile)?.async('string')
      if (sheetXml) {
        results.push(extractTextFromXml(sheetXml))
      }
    }
    const sharedStrings = await zip.file('xl/sharedStrings.xml')?.async('string')
    if (sharedStrings) {
      results.push(extractTextFromXml(sharedStrings))
    }
  } else if (extension === '.pptx' || extension === '.odp') {
    const slideFiles = Object.keys(zip.file).filter(f => f.match(/ppt\/slides\/slide\d+\.xml/))
    for (const slideFile of slideFiles) {
      const slideXml = await zip.file(slideFile)?.async('string')
      if (slideXml) {
        results.push(extractTextFromXml(slideXml))
      }
    }
  }

  return results.filter(Boolean).join('\n\n')
}

/**
 * Simple XML text extraction
 */
function extractTextFromXml(xml: string): string {
  const textMatches = xml.match(/<[^>]+>([^<]*)<\/[^>]+>/g) || []
  return textMatches
    .map(m => m.replace(/<[^>]+>/g, '').trim())
    .filter(t => t.length > 0)
    .join(' ')
}

/**
 * Get basic file information
 */
export async function getFileInfo(filePath: string): Promise<DocumentMetadata> {
  const stats = await stat(filePath)
  const extension = extname(filePath).toLowerCase()
  const langId = getLanguageId(extension)
  const binaryTypes = ['image', 'audio', 'video', 'archive', 'font', '3d', 'cad']

  return {
    file: basename(filePath),
    size: stats.size,
    extension,
    languageId: langId,
    isOfficeDocument: isOfficeDocument(extension),
    isBinary: binaryTypes.includes(langId),
  }
}

// ============================================================================
// Tool Functions
// ============================================================================

/**
 * Extract text content from a file
 * Works with text files, code files, Office documents, etc.
 */
export async function extractText(filePath: string): Promise<string> {
  const extension = extname(filePath).toLowerCase()

  // Office documents
  if (isOfficeDocument(extension)) {
    return extractOfficeText(filePath, extension)
  }

  // Plain text files - read directly
  const textExtensions = new Set([
    '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.html',
    '.htm', '.css', '.js', '.ts', '.py', '.rb', '.php', '.java', '.c', '.cpp',
    '.h', '.hpp', '.cs', '.go', '.rs', '.swift', '.kt', '.scala', '.sh', '.bash',
    '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql', '.toml', '.ini', '.cfg',
    '.conf', '.properties', '.env', '.makefile', '.cmake', '.dockerfile', '.gitignore',
    '.env', '.editorconfig', '.eslintrc', '.prettierrc', '.gitignore',
  ])

  if (textExtensions.has(extension)) {
    const content = await readFile(filePath, 'utf-8')
    return content
  }

  // Try to detect format
  const format = await detectFileFormat(filePath)
  return `Binary file: ${basename(filePath)} (${extension}) - Format: ${format}`
}

/**
 * Get file metadata
 */
export async function getFileMetadata(filePath: string): Promise<DocumentMetadata & { created?: Date; modified?: Date }> {
  const stats = await stat(filePath)
  const info = await getFileInfo(filePath)

  return {
    ...info,
    created: stats.birthtime,
    modified: stats.mtime,
  }
}

/**
 * List supported file types
 */
export function listSupportedTypes() {
  return {
    textExtensions: [
      '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.xml', '.html',
      '.css', '.js', '.ts', '.py', '.rb', '.php', '.java', '.c', '.cpp',
      '.h', '.hpp', '.cs', '.go', '.rs', '.swift', '.kt', '.scala',
    ],
    officeExtensions: ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'],
    imageExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic'],
    audioExtensions: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma'],
    videoExtensions: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
    archiveExtensions: ['.zip', '.tar', '.gz', '.7z', '.rar'],
  }
}
