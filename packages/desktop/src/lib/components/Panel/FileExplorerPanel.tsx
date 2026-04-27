import { Component, For, Show, createSignal, onMount } from 'solid-js'
import { useI18n } from '../../i18n'
import { FolderOpenIcon, FolderIcon, FileIcon, RefreshIcon, PlusIcon } from '../Icons'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir, type DirEntry } from '@tauri-apps/plugin-fs'
import './PanelSystem.css'

interface FileItem {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileItem[]
}

export const FileExplorerPanel: Component = () => {
  const { t } = useI18n()
  const [rootPath, setRootPath] = createSignal<string | null>(null)
  const [files, setFiles] = createSignal<FileItem[]>([])
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  const readDirectory = async (dirPath: string): Promise<FileItem[]> => {
    try {
      const entries = await readDir(dirPath)
      const items: FileItem[] = []

      for (const entry of entries) {
        const fullPath = `${dirPath}/${entry.name}`
        items.push({
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory ? 'folder' : 'file',
        })
      }

      // Sort: folders first, then alphabetically
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return items
    } catch (error) {
      console.error('Failed to read directory:', error)
      return []
    }
  }

  const loadFolder = async (folderPath: string) => {
    setLoading(true)
    try {
      const items = await readDirectory(folderPath)
      setFiles(items)
      setRootPath(folderPath)
      setExpandedFolders(new Set())
    } finally {
      setLoading(false)
    }
  }

  const openFolderDialog = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      })
      if (selected && typeof selected === 'string') {
        await loadFolder(selected)
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error)
    }
  }

  const toggleFolder = async (path: string) => {
    const expanded = new Set(expandedFolders())
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
      // Load children if not already loaded
      const items = files()
      const item = items.find(i => i.path === path)
      if (item && (!item.children || item.children.length === 0)) {
        const children = await readDirectory(path)
        item.children = children
        setFiles([...items])
      }
    }
    setExpandedFolders(expanded)
  }

  const refreshFolder = () => {
    if (rootPath()) {
      loadFolder(rootPath()!)
    }
  }

  const renderFileItem = (item: FileItem, depth: number = 0) => {
    const isExpanded = expandedFolders().has(item.path)
    const isSelected = selectedFile() === item.path
    const hasChildren = item.type === 'folder'

    return (
      <div key={item.path}>
        <div
          class={`tree-item ${item.type} ${isSelected ? 'selected' : ''}`}
          style={{ 'padding-left': `${8 + depth * 16}px` }}
          onClick={() => {
            if (hasChildren) {
              toggleFolder(item.path)
            }
            setSelectedFile(item.path)
          }}
        >
          <span class="tree-indent" />
          <span class="tree-icon">
            {hasChildren ? (
              isExpanded ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />
            ) : (
              <FileIcon size={14} />
            )}
          </span>
          <span class="tree-name">{item.name}</span>
        </div>
        <Show when={hasChildren && isExpanded && item.children}>
          <For each={item.children}>
            {(child) => renderFileItem(child, depth + 1)}
          </For>
        </Show>
      </div>
    )
  }

  return (
    <div class="file-explorer-panel">
      <div class="explorer-header">
        <span class="explorer-path">{rootPath() || t.noFolderOpened}</span>
        <div class="explorer-actions">
          <button class="explorer-btn" onClick={refreshFolder} title={t.refresh || 'Refresh'} disabled={!rootPath()}>
            <RefreshIcon size={14} />
          </button>
          <button class="explorer-btn" onClick={openFolderDialog} title={t.openFolder}>
            <FolderOpenIcon size={14} />
          </button>
        </div>
      </div>

      <Show when={loading()}>
        <div class="explorer-loading">Loading...</div>
      </Show>

      <Show when={!loading() && files().length > 0} fallback={
        <Show when={!loading()}>
          <div class="empty-explorer">
            <div class="empty-explorer-icon">
              <FolderOpenIcon size={48} />
            </div>
            <div class="empty-explorer-title">{t.noFolderOpened}</div>
            <div class="empty-explorer-desc">{t.clickToOpenFolder}</div>
            <button class="empty-explorer-btn" onClick={openFolderDialog}>
              {t.openFolder}
            </button>
          </div>
        </Show>
      }>
        <div class="explorer-tree">
          <For each={files()}>
            {(item) => renderFileItem(item)}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default FileExplorerPanel