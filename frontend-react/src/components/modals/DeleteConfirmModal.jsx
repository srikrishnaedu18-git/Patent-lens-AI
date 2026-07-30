import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../api/client'

export default function DeleteConfirmModal() {
  const { modals, closeModal, activeProjectId, addToast, clearSelection } = useStore()
  const qc = useQueryClient()
  const [loading, setLoading] = useState(false)

  const data = modals.deleteConfirm
  if (!data) return null

  const isDedup = data.isDedup

  async function handleConfirmDelete() {
    setLoading(true)
    try {
      if (isDedup) {
        const res = await apiClient('/api/history/deduplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: activeProjectId, confirm: true }),
        })
        const result = await res.json()
        addToast(`Deduplication complete! Removed ${result.removed_count} duplicate patents.`, 'success')
      } else {
        const res = await apiClient('/api/history/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: activeProjectId,
            search_ids: data.searchIds || [],
            patent_ids: data.patentIds || [],
          }),
        })
        if (!res.ok) throw new Error('Failed to delete')
        addToast('Selected items deleted successfully.', 'success')
        clearSelection()
      }
      qc.invalidateQueries({ queryKey: ['history', activeProjectId] })
      closeModal('deleteConfirm')
    } catch (err) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('deleteConfirm')}>
      <div className="modal modal-alert" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isDedup ? 'Confirm Deduplication' : 'Confirm Delete'}</h3>
          <button className="btn-icon" onClick={() => closeModal('deleteConfirm')}>✕</button>
        </div>

        <div className="modal-body">
          {isDedup ? (
            <p>
              Found <strong>{data.dupCount}</strong> duplicate patent entries across search runs in this project.
              Proceed with removing duplicates? The earliest recorded version of each patent will be preserved.
            </p>
          ) : (
            <p>
              Are you sure you want to delete {data.searchIds?.length || 0} search group(s) and {data.patentIds?.length || 0} patent(s)?
              This action cannot be undone.
            </p>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => closeModal('deleteConfirm')} disabled={loading}>Cancel</button>
          <button className="btn-danger" onClick={handleConfirmDelete} disabled={loading}>
            {loading ? 'Deleting...' : isDedup ? 'Remove Duplicates' : 'Delete Items'}
          </button>
        </div>
      </div>
    </div>
  )
}
