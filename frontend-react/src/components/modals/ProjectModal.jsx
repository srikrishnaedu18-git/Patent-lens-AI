import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../api/client'

export default function ProjectModal() {
  const { modals, closeModal, setActiveProject, setHistorySearches } = useStore()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!modals.project) return null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await apiClient('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to create project' }))
        throw new Error(err.detail || 'Failed to create project')
      }
      const project = await res.json()
      setActiveProject(project.id, project.name)
      setHistorySearches([])
      qc.invalidateQueries({ queryKey: ['projects'] })
      closeModal('project')
      setName('')
      setDescription('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('project')}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New Project</h3>
          <button className="btn-icon" onClick={() => closeModal('project')}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="project-name-input">Project Name *</label>
            <input
              type="text"
              id="project-name-input"
              className="input"
              placeholder="e.g. Battery Management Systems"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="project-desc-input">Description (optional)</label>
            <textarea
              id="project-desc-input"
              className="input textarea-input"
              placeholder="Brief overview of research scope..."
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {error && <div className="auth-error-msg" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => closeModal('project')} disabled={loading}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create Project'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
