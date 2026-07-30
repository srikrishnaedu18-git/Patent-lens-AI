import { useStore } from '../../store/useStore'
import { scoreToRelevancy, formatDate } from '../../utils/helpers'

export default function PatentDetailsModal() {
  const { modals, closeModal } = useStore()
  const data = modals.patentDetails

  if (!data || !data.patent) return null

  const p = data.patent
  const relevancy = scoreToRelevancy(p.confidence_score)

  return (
    <div className="modal-overlay" onClick={() => closeModal('patentDetails')}>
      <div className="modal modal-patent-details" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="patent-serial-badge">#{data.serial}</span>
            <span className="patent-id-badge">{p.patent_id}</span>
            <span className={`relevancy-badge relevancy-badge--${relevancy.toLowerCase()}`}>{relevancy}</span>
          </div>
          <button className="btn-icon" onClick={() => closeModal('patentDetails')}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>{p.title}</h3>

          {p.url && (
            <div style={{ marginBottom: 16 }}>
              <a href={p.url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                View Original Patent Source ↗
              </a>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>Abstract</h4>
            <p style={{ lineHeight: 1.6, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{p.abstract || 'No abstract available.'}</p>
          </div>

          {p.ai_reasoning && (
            <div style={{ marginBottom: 16, background: 'var(--bg-secondary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>🤖 Gemini Assessment</h4>
              <p style={{ fontSize: '0.88rem', lineHeight: 1.5 }}>{p.ai_reasoning}</p>
            </div>
          )}

          {p.overlap_reasons && (
            <div style={{ marginBottom: 12, background: 'rgba(239, 68, 68, 0.08)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <h4 style={{ fontSize: '0.85rem', color: '#ef4444', marginBottom: 4 }}>🔴 Overlap Reasons</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{p.overlap_reasons}</p>
            </div>
          )}

          {p.difference_reasons && (
            <div style={{ marginBottom: 16, background: 'rgba(34, 197, 94, 0.08)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
              <h4 style={{ fontSize: '0.85rem', color: '#22c55e', marginBottom: 4 }}>🟢 Difference Reasons</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{p.difference_reasons}</p>
            </div>
          )}

          {p.deep_scrape_text && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>🔬 Full Deep Scrape Specifications</h4>
              <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.8rem', fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                {p.deep_scrape_text}
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => closeModal('patentDetails')}>Close</button>
        </div>
      </div>
    </div>
  )
}
