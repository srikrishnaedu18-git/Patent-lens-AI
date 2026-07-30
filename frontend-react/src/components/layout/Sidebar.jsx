import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../api/client'

async function fetchProjects() {
  const res = await apiClient('/api/projects')
  if (!res.ok) throw new Error('Failed')
  return res.json()
}

export default function Sidebar() {
  const { activeProjectId, setActiveProject, setHistorySearches, openModal, username, addToast } = useStore()
  const qc = useQueryClient()

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 0,
  })

  async function selectProject(p) {
    setActiveProject(p.id, p.name)
    setHistorySearches([])
    qc.invalidateQueries({ queryKey: ['history', p.id] })
  }

  async function deleteProject(id, name) {
    if (!confirm(`Delete project "${name}"? All associated data will be permanently deleted.`)) return
    try {
      await apiClient(`/api/projects/${id}`, { method: 'DELETE' })
      if (activeProjectId === id) { setActiveProject(null, ''); setHistorySearches([]) }
      qc.invalidateQueries({ queryKey: ['projects'] })
    } catch { addToast('Failed to delete project', 'error') }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    useStore.getState().handleUnauthorized()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-container">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="logo-text">PatentLens</span>
          <span className="logo-badge">Studio</span>
        </div>
        <button id="btn-new-project" className="btn-primary" aria-label="Create New Project" onClick={() => openModal('project')}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Project
        </button>
      </div>

      <div className="projects-list-container">
        <div className="section-title">Projects</div>
        <ul id="projects-list" className="projects-list">
          {projects.length === 0 ? (
            <li className="meta-text" style={{ padding: '10px 0', textAlign: 'center' }}>No projects created</li>
          ) : (
            projects.map(p => (
              <li key={p.id} className={`project-item ${activeProjectId === p.id ? 'active' : ''}`} onClick={() => selectProject(p)}>
                <span className="project-item-name">{p.name}</span>
                <button className="project-delete-btn" aria-label="Delete Project" onClick={e => { e.stopPropagation(); deleteProject(p.id, p.name) }}>
                  <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="sidebar-footer">
        <div id="user-profile-section" className="user-profile-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span id="user-display-name" className="user-display-name">{username}</span>
          <button id="btn-logout" className="btn-logout" title="Sign Out" onClick={logout}>
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

