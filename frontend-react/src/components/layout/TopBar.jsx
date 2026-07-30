import { useQuery } from '@tanstack/react-query'
import { useStore } from '../../store/useStore'
import { parseUtcDate } from '../../utils/helpers'
import { apiClient } from '../../api/client'

export default function TopBar() {
  const { activeProjectId, activeProjectName, theme, setTheme, openModal } = useStore()

  const { data: projectData } = useQuery({
    queryKey: ['projectMeta', activeProjectId],
    queryFn: async () => {
      if (!activeProjectId) return null
      const res = await apiClient(`/api/projects`)
      if (!res.ok) return null
      const projects = await res.json()
      return projects.find(p => p.id === activeProjectId) || null
    },
    enabled: !!activeProjectId,
    staleTime: 60_000,
  })

  const createdAt = projectData?.created_at
    ? parseUtcDate(projectData.created_at).toLocaleDateString()
    : null

  return (
    <header className="top-bar">
      <div className="current-project-info">
        <h1 id="active-project-title">
          {activeProjectName || 'Select a project'}
        </h1>
        {createdAt && (
          <span id="active-project-date" className="meta-text">
            Created: {createdAt}
          </span>
        )}
      </div>

      <div className="top-bar-actions">
        <button
          id="theme-toggle"
          className="theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          title="Toggle Light/Dark Theme"
        >
          <svg id="theme-icon-sun" className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg id="theme-icon-moon" className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>

        <button
          id="btn-settings"
          className="btn-icon"
          onClick={() => openModal('settings')}
          aria-label="Settings"
          title="Settings & Preferences"
        >
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </header>
  )
}

