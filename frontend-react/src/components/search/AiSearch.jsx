import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useSSEStream } from '../../hooks/useSSEStream'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../api/client'
import { formatErrorDetail } from '../../utils/helpers'

export default function AiSearch() {
  const store = useStore()
  const qc = useQueryClient()
  const sse = useSSEStream()
  const [requirement, setRequirement] = useState(store.activeRequirement || '')
  const [maxResults, setMaxResults] = useState(20)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [editableQueries, setEditableQueries] = useState([])
  const [cpcTags, setCpcTags] = useState([])
  const [rationale, setRationale] = useState('')

  const step = store.aiStep // 'input' | 'review'

  async function handleGenerate() {
    if (!requirement.trim()) { store.addToast('Please enter your invention requirement first.', 'warning'); return }
    if (requirement.length < 30) { store.addToast('Requirement too short. Please provide a more descriptive mechanism (minimum 30 characters).', 'warning'); return }
    setGenerating(true)
    try {
      const res = await apiClient('/api/ai/generate-queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(formatErrorDetail(e.detail, 'Failed')) }
      const strategy = await res.json()
      store.setAiResponse(strategy)
      setEditableQueries(strategy.keyword_queries || [])
      setCpcTags(strategy.suggested_cpc_codes || [])
      setRationale(strategy.search_rationale || '')
      store.setAiStep('review')
    } catch (err) {
      store.addToast(`AI Error: ${err.message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function handleConfirm() {
    const queries = editableQueries.filter(Boolean)
    if (!queries.length) { store.addToast('Please configure at least one query to search.', 'warning'); return }
    if (!store.activeProjectId) { store.addToast('Please select a project first.', 'warning'); return }

    store.setActiveRequirement(requirement)
    setConfirming(true)
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine('🚀 Submitting pipeline execution request to backend...', 'info')
    store.initStagePillsForFlow('ai_search')

    try {
      const res = await apiClient('/api/ai/confirm-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: store.activeProjectId, requirement, queries, cpc_codes: cpcTags,
          ai_rationale: rationale, max_results: maxResults, audit_mode: store.auditMode,
          sources: store.searchSources, india_options: store.indiaOptions,
          captcha_mode: store.captchaMode, captcha_service: store.captchaService,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(formatErrorDetail(e.detail, 'Failed')) }
      const { task_id } = await res.json()
      store.addLogLine(`📡 Connection established. Task ID: ${task_id}`, 'info')
      sse.start(task_id)
    } catch (err) {
      store.addLogLine(`❌ Failed to start: ${err.message}`, 'error')
      setConfirming(false)
    }
  }

  function removeQuery(idx) { setEditableQueries(q => q.filter((_, i) => i !== idx)) }
  function updateQuery(idx, val) { setEditableQueries(q => q.map((v, i) => i === idx ? val : v)) }

  if (step === 'review') {
    return (
      <div id="ai-step-review" className="ai-step">
        <div className="ai-rationale-wrap">
          <label>Search Rationale</label>
          <p id="ai-rationale" className="ai-rationale-display">{rationale}</p>
        </div>
        <div className="form-group">
          <label>Generated Search Queries <span className="meta-text">(editable)</span></label>
          <div id="editable-queries" className="editable-queries">
            {editableQueries.map((q, idx) => (
              <div key={idx} className="query-edit-row">
                <span className="query-num">{idx + 1}</span>
                <input type="text" className="query-edit-input" value={q} onChange={e => updateQuery(idx, e.target.value)} />
                <button type="button" className="btn-remove-query" onClick={() => removeQuery(idx)}>
                  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>Suggested CPC Codes</label>
          <div id="cpc-tags" className="cpc-tags-wrap">
            {cpcTags.map((c, i) => <span key={i} className="cpc-tag-pill">{c}</span>)}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group limit-group">
            <label htmlFor="limit-input-ai">Max Results / Query</label>
            <input type="number" id="limit-input-ai" min="1" max="100" value={maxResults} onChange={e => setMaxResults(parseInt(e.target.value) || 20)} />
          </div>
          <button type="button" className="btn-secondary" id="btn-back-to-input" onClick={() => store.setAiStep('input')} disabled={confirming}>← Back</button>
          <button type="button" className="btn-primary btn-submit" id="btn-confirm-search" onClick={handleConfirm} disabled={confirming}>
            <svg className={`icon animate-spin ${confirming ? '' : 'hidden'}`} id="spinner-confirm" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/>
            </svg>
            <span id="btn-confirm-text">{confirming ? 'Initializing Agent...' : 'Confirm & Start Search'}</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div id="ai-step-input" className="ai-step">
      <div className="form-group">
        <label htmlFor="requirement-input">Describe Your Invention / Prior Art Need</label>
        <textarea
          id="requirement-input"
          className="input textarea-input"
          placeholder="Describe your invention mechanism in detail. E.g. 'A system that uses neural networks to classify patent claims by technical domain using transformer-based embeddings...'"
          rows={4}
          value={requirement}
          onChange={e => setRequirement(e.target.value)}
          disabled={generating}
        />
      </div>
      <div className="form-row">
        <div className="form-group limit-group">
          <label htmlFor="limit-input-ai">Max Results / Query</label>
          <input type="number" id="limit-input-ai" min="1" max="100" value={maxResults} onChange={e => setMaxResults(parseInt(e.target.value) || 20)} disabled={generating} />
        </div>
        <button type="button" id="btn-generate-queries" className="btn-ai btn-submit" onClick={handleGenerate} disabled={generating}>
          <svg className={`icon animate-spin ${generating ? '' : 'hidden'}`} id="spinner-ai" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" strokeLinecap="round"/>
          </svg>
          {!generating && (
            <svg id="ai-btn-icon" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          )}
          <span id="btn-generate-text">{generating ? 'Analyzing Requirement...' : 'Generate Queries with AI'}</span>
        </button>
      </div>
    </div>
  )
}
