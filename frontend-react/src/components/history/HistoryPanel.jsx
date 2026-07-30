import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { useSSEStream } from '../../hooks/useSSEStream'
import { apiClient } from '../../api/client'
import { formatErrorDetail, downloadBlob } from '../../utils/helpers'
import SearchGroup from './SearchGroup'
import ExportDropup from '../ui/ExportDropup'

async function fetchHistory(projectId) {
  const res = await apiClient(`/api/projects/${projectId}/data`)
  if (!res.ok) throw new Error('Failed to load project history')
  return res.json()
}

export default function HistoryPanel() {
  const store = useStore()
  const qc = useQueryClient()
  const sse = useSSEStream()
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearchBar, setShowSearchBar] = useState(false)

  const { data: searches = [], isLoading } = useQuery({
    queryKey: ['history', store.activeProjectId],
    queryFn: () => fetchHistory(store.activeProjectId),
    enabled: !!store.activeProjectId,
    staleTime: 0,
    onSuccess: data => store.setHistorySearches(data),
  })

  const activeSearches = useMemo(() => searches.filter(s => s.search_mode !== 'failed'), [searches])

  const selectedPatentCount = store.selectedPatentIds.size

  async function handleAudit() {
    if (!store.activeProjectId) { store.addToast('Please select a project first.', 'warning'); return }
    if (store.selectedPatentIds.size === 0) { store.addToast('Select at least one patent to audit.', 'warning'); return }
    const requirement = store.activeRequirement || store.lastScrapedKeywords || ''
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine(`🤖 Initiating Gemini audit for ${store.selectedPatentIds.size} selected patent(s)...`, 'info')
    store.initStagePillsForFlow('ai_audit')
    store.updateStagePill('auditing', 'active')
    store.setIsAuditRunning(true)
    try {
      const res = await apiClient('/api/ai/audit-selected', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: store.activeProjectId, patent_ids: [...store.selectedPatentIds], requirement }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(formatErrorDetail(e.detail, 'Audit failed')) }
      const { task_id } = await res.json()
      store.addLogLine(`📡 Connection established. Task ID: ${task_id}`, 'info')
      sse.start(task_id)
    } catch (err) {
      store.addLogLine(`❌ Failed to start audit: ${err.message}`, 'error')
      store.addToast(`Could not start AI audit: ${err.message}`, 'error')
      store.setIsAuditRunning(false)
    }
  }

  async function handleDeepScrape() {
    if (!store.activeProjectId) { store.addToast('Please select a project first.', 'warning'); return }
    const ids = [...store.selectedPatentIds]
    if (!ids.length) { store.addToast('Select at least one patent to deep scrape.', 'warning'); return }
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine(`Starting deep scrape for ${ids.length} patent(s)...`, 'info')
    store.initStagePillsForFlow('manual_scrape')
    store.updateStagePill('scraping', 'active')
    store.setIsDeepScrapeRunning(true)
    try {
      const res = await apiClient('/api/deep-scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: store.activeProjectId, patent_ids: ids }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(formatErrorDetail(e.detail, 'Failed')) }
      const { task_id } = await res.json()
      store.addLogLine(`Connection established. Task ID: ${task_id}`, 'info')
      sse.start(task_id, () => { store.setIsDeepScrapeRunning(false); qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] }) })
    } catch (err) {
      store.addLogLine(`Deep scrape failed: ${err.message}`, 'error')
      store.addToast(`Could not start deep scrape: ${err.message}`, 'error')
      store.setIsDeepScrapeRunning(false)
    }
  }

  async function handleDelete() {
    const searchIds = [...store.selectedSearchIds]
    const patentIds = [...store.selectedPatentIds]
    if (!searchIds.length && !patentIds.length) { store.addToast('Please select at least one item to delete.', 'warning'); return }
    store.openModal('deleteConfirm', { searchIds, patentIds, isDedup: false })
  }

  async function handleDeduplicate() {
    if (!store.activeProjectId) { store.addToast('Please select a project first.', 'warning'); return }
    try {
      const res = await apiClient('/api/history/deduplicate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: store.activeProjectId, confirm: false }),
      })
      const data = await res.json()
      if (data.duplicate_count === 0) { store.addToast('No duplicate patents found!', 'success'); return }
      store.openModal('deleteConfirm', { isDedup: true, dupCount: data.duplicate_count, duplicates: data.duplicates })
    } catch (err) { store.addToast(`Deduplication error: ${err.message}`, 'error') }
  }

  function selectAll() {
    const allPatentIds = activeSearches.flatMap(s => (s.patents || []).map(p => p.id))
    const allSearchIds = activeSearches.map(s => s.id)
    store.selectAll(allPatentIds, allSearchIds)
  }

  if (!store.activeProjectId) {
    return (
      <div id="history-panel" className="history-panel">
        <div className="meta-text" style={{ padding: 40, textAlign: 'center' }}>
          Select or create a project to view patent history.
        </div>
      </div>
    )
  }

  return (
    <div id="history-panel" className="results-section">
      <div className="section-header">
        <div className="scraped-history-header-left">
          <input
            type="checkbox"
            id="select-all-history-checkbox"
            className="history-select-all-cb"
            title="Select All / Deselect All"
            onChange={e => e.target.checked ? selectAll() : store.clearSelection()}
          />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            Scraped History
            {selectedPatentCount > 0 && (
              <span className="selected-count-badge" style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 12, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                {selectedPatentCount} selected
              </span>
            )}
          </h2>
        </div>

        <div className="global-export-panel">
          <button
            id="btn-toggle-search"
            type="button"
            className={`btn-secondary btn-icon btn-search-toggle ${showSearchBar ? 'active' : ''}`}
            title="Search patents"
            onClick={() => { setShowSearchBar(!showSearchBar); if (showSearchBar) store.setSearchQuery('') }}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>

          <button
            id="btn-relevancy-filter"
            type="button"
            className={`btn-secondary btn-icon btn-filter ${(store.filters.relevancy?.length || store.filters.aiAudit?.length || store.filters.deepScrape?.length || store.filters.source?.length) ? 'active' : ''}`}
            title="Filter by Relevancy"
            onClick={() => store.openModal('filter')}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
          </button>

          <button
            id="btn-deduplicate-history"
            type="button"
            className="btn-secondary btn-icon btn-deduplicate"
            title="Deduplicate History (Keep Latest Copy)"
            onClick={handleDeduplicate}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
              <path d="M4 18V6a2 2 0 0 1 2-2h10" />
              <line x1="12" y1="12" x2="16" y2="12" />
            </svg>
          </button>

          <button
            id="btn-global-ai-audit"
            type="button"
            className={`btn-secondary btn-ai-audit-global ${store.isAuditRunning ? 'disabled' : ''}`}
            title="Audit Selected Patents with AI"
            onClick={handleAudit}
            disabled={store.isAuditRunning}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span>{store.isAuditRunning ? 'Auditing...' : 'AI Audit'}</span>
          </button>

          <button
            id="btn-global-deep-scrape"
            type="button"
            className={`btn-secondary btn-deep-scrape-global ${store.isDeepScrapeRunning ? 'disabled' : ''}`}
            title="Deep Scrape Selected Patents"
            onClick={handleDeepScrape}
            disabled={store.isDeepScrapeRunning}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              <path d="M10 7v6m3-3H7" />
            </svg>
            <span>{store.isDeepScrapeRunning ? 'Scraping...' : 'Deep Scrape'}</span>
          </button>

          <button
            id="btn-global-delete"
            type="button"
            className="btn-danger btn-delete-global"
            title="Delete Selected Items"
            onClick={handleDelete}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          <ExportDropup />
        </div>
      </div>

      {/* Search bar */}
      {showSearchBar && (
        <div id="search-bar-container" className="search-bar-container" style={{ marginTop: 12 }}>
          <input type="text" id="input-patent-search" className="input" placeholder="Search patents by title, abstract, ID..." value={store.searchQuery} onChange={e => store.setSearchQuery(e.target.value)} autoFocus />
          <button className="btn-icon" id="btn-clear-search" onClick={() => store.setSearchQuery('')}>✕</button>
        </div>
      )}

      {/* History list */}
      <div id="history-container" className="history-container" style={{ marginTop: 16 }}>
        {isLoading ? (
          <div className="meta-text" style={{ padding: 40, textAlign: 'center' }}>Loading history...</div>
        ) : activeSearches.length === 0 ? (
          <div className="meta-text" style={{ padding: 40, textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-color)' }}>
            No prior art searches recorded for this project yet.
          </div>
        ) : (
          <>
            {activeSearches.map((s, idx) => {
              let startSerial = 1
              for (let i = 0; i < idx; i++) startSerial += (activeSearches[i].patents || []).length
              return <SearchGroup key={s.id} search={s} startSerial={startSerial} />
            })}
          </>
        )}
      </div>
    </div>
  )
}

