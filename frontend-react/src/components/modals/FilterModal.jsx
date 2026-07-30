import { useState } from 'react'
import { useStore } from '../../store/useStore'

export default function FilterModal() {
  const { modals, closeModal, filters, setFilters, resetFilters } = useStore()

  const [relevancy, setRelevancy] = useState(filters.relevancy || [])
  const [aiAudit, setAiAudit] = useState(filters.aiAudit || [])
  const [deepScrape, setDeepScrape] = useState(filters.deepScrape || [])
  const [source, setSource] = useState(filters.source || [])

  if (!modals.filter) return null

  function toggleItem(arr, setArr, item) {
    if (arr.includes(item)) setArr(arr.filter(x => x !== item))
    else setArr([...arr, item])
  }

  function handleApply() {
    setFilters({ relevancy, aiAudit, deepScrape, source })
    closeModal('filter')
  }

  function handleReset() {
    setRelevancy([])
    setAiAudit([])
    setDeepScrape([])
    setSource([])
    resetFilters()
    closeModal('filter')
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('filter')}>
      <div className="modal modal-filter" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Filter Patents</h3>
          <button className="btn-icon" onClick={() => closeModal('filter')}>✕</button>
        </div>

        <div className="form-group">
          <label>Relevancy Assessment</label>
          <div className="checkbox-group" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {['Red', 'Yellow', 'Green', 'Unaudited'].map(r => (
              <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={relevancy.includes(r)} onChange={() => toggleItem(relevancy, setRelevancy, r)} />
                <span>{r}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>AI Audit Status</label>
          <div className="checkbox-group" style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={aiAudit.includes('audited')} onChange={() => toggleItem(aiAudit, setAiAudit, 'audited')} />
              <span>Audited</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={aiAudit.includes('not_audited')} onChange={() => toggleItem(aiAudit, setAiAudit, 'not_audited')} />
              <span>Not Audited</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>Deep Scrape Status</label>
          <div className="checkbox-group" style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={deepScrape.includes('scraped')} onChange={() => toggleItem(deepScrape, setDeepScrape, 'scraped')} />
              <span>Deep Scraped</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={deepScrape.includes('not_scraped')} onChange={() => toggleItem(deepScrape, setDeepScrape, 'not_scraped')} />
              <span>Not Deep Scraped</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>Data Source</label>
          <div className="checkbox-group" style={{ display: 'flex', gap: 12 }}>
            {[['google','Google Patents'],['india','Indian Patents'],['espacenet','Espacenet']].map(([v,l]) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={source.includes(v)} onChange={() => toggleItem(source, setSource, v)} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={handleReset}>Reset All</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => closeModal('filter')}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleApply}>Apply Filters</button>
          </div>
        </div>
      </div>
    </div>
  )
}
