import { useState, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { useSSEStream } from '../../hooks/useSSEStream'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../api/client'
import { buildEspacenetQuery, formatErrorDetail } from '../../utils/helpers'
import IndiaQueryBuilder from './IndiaQueryBuilder'
import EspacenetQueryBuilder from './EspacenetQueryBuilder'

export default function ManualSearch() {
  const store = useStore()
  const qc = useQueryClient()
  const sse = useSSEStream()
  const [loading, setLoading] = useState(false)
  const [directLoading, setDirectLoading] = useState(false)
  const [maxResults, setMaxResults] = useState(20)
  const [googleKeywords, setGoogleKeywords] = useState('')
  const [allKeywords, setAllKeywords] = useState('')
  const indiaRowsRef = useRef([])
  const espacenetRowsRef = useRef([])

  const source = store.searchSources[0] || 'google'

  function setSource(src) {
    store.setSearchSources([src])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!store.activeProjectId) { store.addToast('Please select or create a project first.', 'warning'); return }

    let keywords = ''
    let indiaRows = []
    let espacenetRows = []

    if (source === 'all') {
      keywords = allKeywords.trim()
      if (!keywords) { store.addToast('Please enter at least one keyword for multi-platform search.', 'warning'); return }
      const enabledSources = ['google', 'india', 'espacenet'].filter(s => (store.allSelectedSources || []).includes(s))
      if (!enabledSources.length) { store.addToast('Please select at least one platform pill to search.', 'warning'); return }

      setLoading(true)
      store.setIsScraping(true)
      store.setIsTerminateVisible(true)
      store.setShowLiveFeed(true)
      store.clearLogs()
      store.addLogLine(`🚀 Starting Sequential Search for "${keywords}" across: [${enabledSources.join(', ').toUpperCase()}]...`, 'info')
      store.initStagePillsForFlow('manual_scrape')

      for (let i = 0; i < enabledSources.length; i++) {
        const src = enabledSources[i]
        store.initStagePillsForFlow('manual_scrape')
        store.addLogLine(`\n🌐 [Step ${i + 1}/${enabledSources.length}] Launching ${src.toUpperCase()}...`, 'info')
        const payload = {
          project_id: store.activeProjectId, max_results: maxResults,
          sources: [src], captcha_mode: store.captchaMode, captcha_service: store.captchaService, keywords,
        }
        if (src === 'india') payload.india_options = { rows: [{ field: 'CSP', text: keywords, logic: 'AND' }] }
        if (src === 'espacenet') payload.espacenet_options = { query_lang: store.espacenetOptions.query_lang || 'en', rows: [{ field: 'TA', operator: 'all', text: keywords, logic: 'AND' }] }
        try {
          const res = await apiClient('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          if (!res.ok) { const e = await res.json(); store.addLogLine(`❌ ${src.toUpperCase()} failed: ${e.detail || 'Error'}`, 'error'); continue }
          const result = await res.json()
          if (result.status === 'processing') {
            store.activeFlow = 'manual_scrape'
            await new Promise(resolve => sse.start(result.task_id, resolve))
          }
        } catch (err) { store.addLogLine(`⚠️ ${src.toUpperCase()} error: ${err.message}`, 'warning') }
      }

      setLoading(false)
      store.setIsScraping(false)
      store.addLogLine('🎉 Sequential Multi-Platform Search Completed!', 'success')
      setAllKeywords('')
      qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] })
      return
    }

    if (source === 'google') {
      keywords = googleKeywords.trim()
      if (!keywords) { store.addToast('Please enter at least one keyword.', 'warning'); return }
    } else if (source === 'espacenet') {
      espacenetRows = espacenetRowsRef.current || []
      if (!espacenetRows.length || espacenetRows.every(r => !r.text)) { store.addToast('Please provide at least one Espacenet search term.', 'warning'); return }
      store.setEspacenetOptions({ ...store.espacenetOptions, rows: espacenetRows })
      keywords = buildEspacenetQuery(espacenetRows)
    } else {
      indiaRows = indiaRowsRef.current || []
      if (!indiaRows.length || indiaRows.every(r => !r.text)) { store.addToast('Please provide at least one query search term.', 'warning'); return }
      store.setIndiaOptions({ ...store.indiaOptions, rows: indiaRows })
      keywords = indiaRows.filter(r => r.text).map(r => `${r.field}: ${r.text}`).join(' ')
    }

    setLoading(true)
    store.setIsScraping(true)
    store.setIsTerminateVisible(true)
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine(`🚀 Initializing manual keyword search...`, 'info')
    store.initStagePillsForFlow('manual_scrape')
    store.updateStagePill('planning', 'active')

    try {
      const res = await apiClient('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: store.activeProjectId, keywords, max_results: maxResults,
          sources: store.searchSources, india_options: store.indiaOptions,
          espacenet_options: store.espacenetOptions, captcha_mode: store.captchaMode, captcha_service: store.captchaService,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Scrape failed') }
      const result = await res.json()
      if (result.status === 'processing') {
        store.addLogLine(`📡 Connection established. Task ID: ${result.task_id}`, 'info')
        store.initStagePillsForFlow('manual_scrape')
        sse.start(result.task_id)
      } else {
        store.addLogLine('💾 Search results saved successfully.', 'success')
        if (source === 'google') setGoogleKeywords('')
        qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] })
        setLoading(false)
        store.setIsScraping(false)
      }
    } catch (err) {
      store.addLogLine(`❌ Error: ${err.message}`, 'error')
      store.addToast(`Error running scrape: ${err.message}`, 'error')
      setLoading(false)
      store.setIsScraping(false)
      store.setIsTerminateVisible(false)
    }
  }

  async function handleDirectDeepScrape() {
    if (!store.activeProjectId) { store.addToast('Please select or create a project first.', 'warning'); return }
    const raw = googleKeywords.trim()
    if (!raw) { store.addToast('Please enter publication numbers (e.g. US11952460B2, JP7502368B2) in the keywords input box.', 'warning'); return }
    setDirectLoading(true)
    store.setIsScraping(true)
    store.setIsTerminateVisible(true)
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine(`⚡ Starting Direct Deep Scrape for: "${raw}"...`, 'info')
    store.initStagePillsForFlow('direct_deep_scrape')
    store.updateStagePill('scraping', 'active')
    try {
      const res = await apiClient('/api/direct-deep-scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: store.activeProjectId, keywords: raw }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed') }
      const result = await res.json()
      if (result.status === 'processing') {
        store.addLogLine(`📡 Connection established. Task ID: ${result.task_id}`, 'info')
        sse.start(result.task_id, () => { setDirectLoading(false); setGoogleKeywords(''); qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] }) })
      } else {
        store.addLogLine('💾 Direct deep scrape complete.', 'success')
        setGoogleKeywords('')
        qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] })
        setDirectLoading(false)
        store.setIsScraping(false)
      }
    } catch (err) {
      store.addLogLine(`❌ Error: ${err.message}`, 'error')
      store.addToast(`Error running direct deep scrape: ${err.message}`, 'error')
      setDirectLoading(false)
      store.setIsScraping(false)
      store.setIsTerminateVisible(false)
    }
  }

  const busy = loading || directLoading

  return (
    <form id="scrape-form-manual" className="scrape-form" onSubmit={handleSubmit}>
      {/* Source toggle buttons */}
      <div className="source-toggle-bar" style={{ marginBottom: 20 }}>
        <div className="source-toggle-group" role="group" aria-label="Search source">
          <button type="button" className={`source-toggle-btn ${source === 'all' ? 'active' : ''}`} data-source="all" onClick={() => setSource('all')} title="Run search sequentially across all enabled platforms">
            🌐 All Platforms
          </button>
          <button type="button" className={`source-toggle-btn ${source === 'google' ? 'active' : ''}`} data-source="google" onClick={() => setSource('google')}>
            Google Patents
          </button>
          <button type="button" className={`source-toggle-btn ${source === 'india' ? 'active' : ''}`} data-source="india" onClick={() => setSource('india')}>
            Indian Patents
          </button>
          <button type="button" className={`source-toggle-btn ${source === 'espacenet' ? 'active' : ''}`} data-source="espacenet" onClick={() => setSource('espacenet')}>
            Espacenet
          </button>
        </div>
      </div>

      {/* All Platforms pills & input */}
      {source === 'all' && (
        <div id="group-keywords-all" className="source-fields-group">
          <div className="form-group flex-grow">
            <label htmlFor="keywords-input-all">Keywords</label>
            <input
              type="text"
              id="keywords-input-all"
              className="input"
              placeholder="e.g. smart irrigation, IoT soil sensor, crop water management"
              value={allKeywords}
              onChange={e => setAllKeywords(e.target.value)}
              disabled={busy}
            />
            <div className="all-platforms-selector-bar" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Scrape in Order:</span>
              <div className="all-platforms-pills" style={{ display: 'flex', gap: 8 }}>
                {['google','india','espacenet'].map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`all-platform-pill ${store.allSelectedSources.includes(s) ? 'active' : ''}`}
                    data-all-source={s}
                    onClick={() => store.toggleAllSource(s)}
                  >
                    {s === 'google' ? 'Google Patents' : s === 'india' ? 'Indian Patents' : 'Espacenet'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google keywords */}
      {source === 'google' && (
        <div id="group-keywords-google" className="source-fields-group">
          <div className="form-row">
            <div className="form-group flex-grow">
              <label htmlFor="keywords-input">Keywords</label>
              <input type="text" id="keywords-input" className="input" placeholder="e.g. machine learning, neural network" value={googleKeywords} onChange={e => setGoogleKeywords(e.target.value)} disabled={busy} />
            </div>
          </div>
        </div>
      )}

      {/* India query builder */}
      {source === 'india' && (
        <div id="group-keywords-india" className="source-fields-group">
          <IndiaQueryBuilder onRowsChange={rows => { indiaRowsRef.current = rows }} disabled={busy} />
        </div>
      )}

      {/* Espacenet query builder */}
      {source === 'espacenet' && (
        <div id="group-keywords-espacenet" className="source-fields-group">
          <EspacenetQueryBuilder onRowsChange={rows => { espacenetRowsRef.current = rows }} disabled={busy} />
        </div>
      )}

      {/* Max results + Submit */}
      <div className="form-row">
        <div className="form-group limit-group">
          <label htmlFor="limit-input-manual">Max Results</label>
          <input type="number" id="limit-input-manual" min="1" max="100" value={maxResults} onChange={e => setMaxResults(parseInt(e.target.value) || 20)} disabled={busy} />
        </div>
        <button type="submit" id="btn-manual-scrape" className="btn-primary btn-submit" disabled={busy}>
          <svg className={`icon animate-spin ${loading ? '' : 'hidden'}`} id="spinner-manual" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/>
          </svg>
          <span id="btn-manual-text">{loading ? 'Scraping...' : 'Scrape Patents'}</span>
        </button>
        {source === 'google' && (
          <button type="button" id="btn-direct-deep-scrape" className="btn-primary btn-submit" onClick={handleDirectDeepScrape} disabled={busy} title="Directly deep scrape publication numbers separated by comma (e.g. US11952460B2, JP7502368B2)">
            <svg className={`icon animate-spin ${directLoading ? '' : 'hidden'}`} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/>
            </svg>
            <span id="btn-direct-deep-text">{directLoading ? 'Deep Scraping...' : '⚡ Direct Deep Scrape'}</span>
          </button>
        )}
      </div>
    </form>
  )
}
