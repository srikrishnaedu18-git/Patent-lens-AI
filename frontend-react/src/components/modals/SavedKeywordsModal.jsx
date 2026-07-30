import { useStore } from '../../store/useStore'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../api/client'
import { formatDate } from '../../utils/helpers'

export default function SavedKeywordsModal() {
  const { modals, closeModal, activeProjectId, setSearchMode, setGoogleKeywordsValue } = useStore()

  const { data: saved = [], isLoading } = useQuery({
    queryKey: ['savedKeywords', activeProjectId],
    queryFn: async () => {
      if (!activeProjectId) return []
      const res = await apiClient(`/api/projects/${activeProjectId}/saved-keywords`)
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!modals.savedKeywords && !!activeProjectId,
  })

  if (!modals.savedKeywords) return null

  function handleUse(query) {
    setGoogleKeywordsValue(query)
    setSearchMode('manual')
    closeModal('savedKeywords')
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('savedKeywords')}>
      <div className="modal modal-keywords" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Saved Keyword Strategies & Queries</h3>
          <button className="btn-icon" onClick={() => closeModal('savedKeywords')}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {isLoading ? (
            <div className="meta-text" style={{ padding: 20, textAlign: 'center' }}>Loading saved strategies...</div>
          ) : saved.length === 0 ? (
            <div className="meta-text" style={{ padding: 20, textAlign: 'center' }}>No saved search strategies found for this project.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {saved.map((item, idx) => (
                <div key={idx} style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>{item.query}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Source: {item.source} • Saved on {formatDate(item.created_at)}
                    </div>
                  </div>
                  <button className="btn-secondary btn-sm" onClick={() => handleUse(item.query)}>Use Query</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => closeModal('savedKeywords')}>Close</button>
        </div>
      </div>
    </div>
  )
}
