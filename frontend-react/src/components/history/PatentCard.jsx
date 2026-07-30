import { useStore } from '../../store/useStore'
import { scoreToRelevancy, escapeHtml, escapeRegExp } from '../../utils/helpers'
import { useSSEStream } from '../../hooks/useSSEStream'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../api/client'

export default function PatentCard({ patent, search, serial }) {
  const store = useStore()
  const qc = useQueryClient()
  const sse = useSSEStream()

  const isSelected = store.selectedPatentIds.has(patent.id)
  const score = patent.confidence_score
  const relevancy = scoreToRelevancy(score)
  const isDeepScraped = Boolean(patent.deep_scrape_text)

  function handleCheckboxChange(e) {
    const checked = e.target.checked
    store.togglePatentSelect(patent.id, checked)
  }

  async function handleSingleDeepScrape(e) {
    e.stopPropagation()
    if (!store.activeProjectId) return
    store.setShowLiveFeed(true)
    store.clearLogs()
    store.addLogLine(`Starting deep scrape for patent #${patent.id} (${patent.patent_id})...`, 'info')
    store.initStagePillsForFlow('manual_scrape')
    store.updateStagePill('scraping', 'active')
    store.setIsDeepScrapeRunning(true)
    try {
      const res = await apiClient('/api/deep-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: store.activeProjectId, patent_ids: [patent.id] }),
      })
      if (!res.ok) throw new Error('Failed to start deep scrape')
      const { task_id } = await res.json()
      sse.start(task_id, () => {
        store.setIsDeepScrapeRunning(false)
        qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] })
      })
    } catch (err) {
      store.addLogLine(`Deep scrape error: ${err.message}`, 'error')
      store.setIsDeepScrapeRunning(false)
    }
  }

  // Highlight search terms
  const terms = (search?.query || store.searchQuery || '')
    .split(/\s+/)
    .map(t => escapeRegExp(t))
    .filter(t => t.length > 2)

  function renderHighlightedText(text) {
    if (!text) return ''
    if (!terms.length) return text
    const regex = new RegExp(`(${terms.join('|')})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="term-highlight">{part}</mark> : part
    )
  }

  const hasOverlap = patent.overlap_reasons && patent.overlap_reasons.trim()
  const hasDifference = patent.difference_reasons && patent.difference_reasons.trim()
  const hasBasicReasoning = patent.ai_reasoning && patent.ai_reasoning.trim()

  return (
    <div
      className={`patent-card relevancy-${relevancy.toLowerCase()}`}
      id={`patent-card-${patent.id}`}
      data-patent-id={patent.id}
      data-serial={serial}
      data-relevancy={relevancy}
      onClick={(e) => {
        if (e.target.closest('.patent-select-checkbox') || e.target.closest('.patent-id-badge') || e.target.closest('.btn-card-deep-scrape')) return
        store.openModal('patentDetails', { patent, search, serial })
      }}
    >
      <input
        type="checkbox"
        className="patent-select-checkbox"
        checked={isSelected}
        onChange={handleCheckboxChange}
        title="Select patent"
      />
      <div className="patent-card-content">
        <div className="patent-card-header">
          <div className="patent-title-line">
            <span className="patent-serial-badge" title={`Absolute Serial Number #${serial}`}>#{serial}</span>
            <a href={patent.url || '#'} target="_blank" rel="noreferrer" className="patent-id-badge" title="Open patent">
              {patent.patent_id || 'Patent'}
              <svg style={{ width: 12, height: 12, marginLeft: 3 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
            <h4 className="patent-title">{renderHighlightedText(patent.title || 'Untitled Patent')}</h4>
          </div>
          <button
            type="button"
            className={`btn-card-deep-scrape ${isDeepScraped ? 'btn-card-deep-scrape--done' : 'btn-card-deep-scrape--pending'}`}
            onClick={handleSingleDeepScrape}
            title={isDeepScraped ? 'Refresh deep scrape' : 'Deep scrape this patent'}
          >
            {isDeepScraped ? 'Deep scraped' : 'Deep scrape'}
          </button>
          <span className={`relevancy-badge relevancy-badge--${relevancy.toLowerCase()}`}>{relevancy}</span>
        </div>

        <p className="patent-abstract">{renderHighlightedText(patent.abstract || '')}</p>

        {(hasBasicReasoning || hasOverlap || hasDifference) && (
          <div className="ai-reasoning-callout">
            {hasBasicReasoning && (
              <>
                <div className="reasoning-header">🤖 Gemini Assessment</div>
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>{patent.ai_reasoning}</div>
              </>
            )}
            {hasOverlap && (
              <div className="ai-reasoning-section overlap-section">
                <div className="section-label">🔴 Why It Overlaps With Your Invention</div>
                <div className="section-text">{patent.overlap_reasons}</div>
              </div>
            )}
            {hasDifference && (
              <div className="ai-reasoning-section difference-section">
                <div className="section-label">🟢 How Your Invention Differs</div>
                <div className="section-text">{patent.difference_reasons}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
