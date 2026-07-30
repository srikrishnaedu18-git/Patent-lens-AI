import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { formatDate } from '../../utils/helpers'
import PatentList from './PatentList'

export default function SearchGroup({ search, startSerial = 1 }) {
  const store = useStore()
  const [isOpen, setIsOpen] = useState(true)

  const isAi = search.search_mode === 'ai'
  const patents = search.patents || []
  const endSerial = startSerial + patents.length - 1
  const rangeBadge = patents.length > 0 ? `#${startSerial} - #${endSerial}` : ''

  // Filter check
  const filteredPatents = patents.filter(p => {
    const f = store.filters || {}
    if (f.relevancy?.length && !f.relevancy.includes(p.confidence_score >= 0.75 ? 'Red' : p.confidence_score >= 0.4 ? 'Yellow' : p.confidence_score !== null ? 'Green' : 'Unaudited')) return false
    if (f.aiAudit?.length) {
      const isAudited = Boolean(p.ai_reasoning || (p.confidence_score !== null && p.confidence_score !== undefined))
      if (!f.aiAudit.includes(isAudited ? 'audited' : 'not_audited')) return false
    }
    if (f.deepScrape?.length) {
      const isScraped = Boolean(p.deep_scrape_text || p.deep_scraped_at)
      if (!f.deepScrape.includes(isScraped ? 'scraped' : 'not_scraped')) return false
    }
    if (f.source?.length) {
      const rawSource = ((search.search_source) || p.source || 'google').toLowerCase()
      let norm = 'google'
      if (rawSource.includes('india') || rawSource.includes('in')) norm = 'india'
      else if (rawSource.includes('espa') || rawSource.includes('epo')) norm = 'espacenet'
      if (!f.source.includes(norm)) return false
    }
    if (store.searchQuery) {
      const q = store.searchQuery.toLowerCase()
      const fields = [p.patent_id || '', p.title || '', p.abstract || '', search.query || '', p.ai_reasoning || '', p.overlap_reasons || '', p.difference_reasons || '', p.deep_scrape_text || '']
      if (!fields.some(f => f.toLowerCase().includes(q))) return false
    }
    return true
  })

  const hasActiveFilters = (store.filters.relevancy?.length || store.filters.aiAudit?.length || store.filters.deepScrape?.length || store.filters.source?.length)
  if (hasActiveFilters && filteredPatents.length === 0) return null

  const isAllChecked = patents.length > 0 && patents.every(p => store.selectedPatentIds.has(p.id))

  function handleHeaderCheckbox(e) {
    e.stopPropagation()
    const checked = e.target.checked
    const pIds = patents.map(p => p.id)
    store.toggleSearchSelect(search.id, pIds, checked)
  }

  return (
    <div className={`query-card ${isOpen ? 'open' : ''}`} id={`query-card-${search.id}`}>
      <div className="query-card-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="query-title-info">
          <input
            type="checkbox"
            className="keyword-select-checkbox"
            checked={isAllChecked}
            onChange={handleHeaderCheckbox}
            onClick={e => e.stopPropagation()}
            title="Select all patents in this group"
          />
          <span className={`query-tag ${isAi ? 'ai-tag' : 'manual-tag'}`}>
            {isAi ? 'AI Pipeline' : 'Keyword'}
          </span>
          <span className="query-text" title={search.query}>{search.query}</span>
          {rangeBadge && <span className="serial-range-badge" title="Serial Number Range">{rangeBadge}</span>}
          <span className="meta-text">{formatDate(search.created_at)}</span>
        </div>
        <div className="query-actions-wrapper">
          <button type="button" className="btn-icon toggle-expand-btn" aria-label="Toggle accordion">
            <svg className="icon chevron" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="query-card-body">
          {isAi && (
            <div className="ai-meta-display">
              {search.ai_queries?.length > 0 && (
                <div className="ai-meta-row">
                  <strong>Generated Queries:</strong>
                  <div className="ai-meta-pills">
                    {search.ai_queries.map((q, i) => <span key={i} className="ai-meta-pill-query">{q}</span>)}
                  </div>
                </div>
              )}
              {search.ai_cpc_codes?.length > 0 && (
                <div className="ai-meta-row">
                  <strong>Suggested CPC Codes:</strong>
                  <div className="ai-meta-pills">
                    {search.ai_cpc_codes.map((c, i) => <span key={i} className="cpc-tag-pill">{c}</span>)}
                  </div>
                </div>
              )}
              {search.ai_rationale && (
                <div className="ai-meta-row">
                  <strong>Search Rationale:</strong>
                  <p className="ai-rationale-display">{search.ai_rationale}</p>
                </div>
              )}
            </div>
          )}

          <PatentList patents={filteredPatents} search={search} startSerial={startSerial} />
        </div>
      )}
    </div>
  )
}
