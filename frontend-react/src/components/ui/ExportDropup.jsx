import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../api/client'
import { downloadBlob, formatErrorDetail } from '../../utils/helpers'

const EXPORT_CONFIG = {
  md: { label: 'Markdown', apiFormat: 'markdown', ext: '.md', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
  csv: { label: 'CSV', apiFormat: 'csv', ext: '.csv', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></> },
  json: { label: 'JSON', apiFormat: 'json', ext: '.json', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1a2 2 0 0 0 2 2 2 2 0 0 0 2-2z"/><path d="M14 12a2 2 0 0 0 2-2 2 2 0 0 0 2 2v1a2 2 0 0 0-2 2 2 2 0 0 0-2-2z"/></> },
}

export default function ExportDropup() {
  const store = useStore()
  const [isOpen, setIsOpen] = useState(false)
  const [isHoverOpen, setIsHoverOpen] = useState(false)
  const [hoverTimer, setHoverTimer] = useState(null)

  const formatKey = store.currentExportFormatKey || 'md'
  const currentConfig = EXPORT_CONFIG[formatKey] || EXPORT_CONFIG.md

  async function triggerExport(targetFormatKey) {
    const key = targetFormatKey || formatKey
    const config = EXPORT_CONFIG[key]
    if (!store.activeProjectId) { store.addToast('Please select a project first.', 'warning'); return }

    store.setCurrentExportFormatKey(key)
    setIsOpen(false)
    setIsHoverOpen(false)

    const patentIds = store.selectedPatentIds.size > 0 ? [...store.selectedPatentIds] : null
    const body = {}
    if (patentIds) body.patent_ids = patentIds
    if (store.activeFilter.length > 0) body.relevancy_filter = store.activeFilter

    try {
      const res = await apiClient(`/api/projects/${store.activeProjectId}/export/${config.apiFormat}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Export failed' }))
        throw new Error(formatErrorDetail(err.detail, 'Export failed'))
      }
      const blob = await res.blob()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const cleanProjName = (store.activeProjectName || 'project').replace(/[^a-z0-9]/gi, '_').toLowerCase()
      downloadBlob(blob, `patentlens_${cleanProjName}_${patentIds ? 'selected' : 'all'}_${timestamp}${config.ext}`)
    } catch (err) {
      store.addToast(`Export failed: ${err.message}`, 'error')
    }
  }

  function handleMouseEnter() {
    if (hoverTimer) clearTimeout(hoverTimer)
    setIsHoverOpen(true)
  }

  function handleMouseLeave() {
    const timer = setTimeout(() => setIsHoverOpen(false), 150)
    setHoverTimer(timer)
  }

  return (
    <div
      id="export-split-container"
      className={`export-split-dropdown-container ${isOpen ? 'open' : ''} ${isHoverOpen ? 'hover-open' : ''}`}
    >
      <div className="export-split-btn-group">
        <button
          type="button"
          id="btn-global-export-main"
          className="btn-export-main"
          onClick={() => triggerExport(formatKey)}
          title={`Export in default format (${currentConfig.label})`}
        >
          <svg className="icon-sm" id="export-main-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {currentConfig.icon}
          </svg>
          <span id="export-main-label">{currentConfig.label}</span>
        </button>

        <button
          type="button"
          id="btn-global-export-toggle"
          className="btn-export-toggle"
          onClick={() => setIsOpen(!isOpen)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          title="Choose export format"
        >
          <svg className="icon-xs export-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </div>

      <div
        id="export-dropup-menu"
        className="export-dropup-menu"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="dropup-header">Export Format</div>

        {Object.entries(EXPORT_CONFIG).map(([k, cfg]) => (
          <div key={k} className="export-format-item" data-format={k}>
            <div
              className="export-format-body"
              onClick={() => triggerExport(k)}
            >
              <svg className="icon-sm format-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {cfg.icon}
              </svg>
              <div className="format-info">
                <span className="format-title">{cfg.label}</span>
                <span className="format-ext">{cfg.ext}</span>
              </div>
              {k === formatKey && <span className="default-badge">Default</span>}
            </div>

            <button
              type="button"
              className="btn-direct-download"
              title={`Direct download ${cfg.label}`}
              onClick={(e) => {
                e.stopPropagation()
                triggerExport(k)
              }}
            >
              <svg className="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

