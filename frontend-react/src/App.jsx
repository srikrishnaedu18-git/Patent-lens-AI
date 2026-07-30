import { useEffect } from 'react'
import { useStore } from './store/useStore'
import AuthOverlay from './components/auth/AuthOverlay'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import SearchPanel from './components/search/SearchPanel'
import LiveFeed from './components/stream/LiveFeed'
import HistoryPanel from './components/history/HistoryPanel'
import Toast from './components/ui/Toast'
import ProjectModal from './components/modals/ProjectModal'
import PatentDetailsModal from './components/modals/PatentDetailsModal'
import FilterModal from './components/modals/FilterModal'
import SettingsModal from './components/modals/SettingsModal'
import IndiaOptionsModal from './components/modals/IndiaOptionsModal'
import CaptchaModal from './components/modals/CaptchaModal'
import SavedKeywordsModal from './components/modals/SavedKeywordsModal'
import DeleteConfirmModal from './components/modals/DeleteConfirmModal'
import InventionModal from './components/modals/InventionModal'

export default function App() {
  const { isAuthenticated, setAuthenticated, setUsername, setTheme, theme, activeProjectId } = useStore()

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.classList.toggle('light-theme', theme === 'light')
  }, [theme])

  // Check auth on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => {
        if (r.status === 200) return r.json()
        throw new Error('not logged in')
      })
      .then(data => {
        setUsername(data.username)
        setAuthenticated(true)
      })
      .catch(() => setAuthenticated(false))
  }, [])

  if (isAuthenticated === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!isAuthenticated) return <AuthOverlay />

  return (
    <>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <TopBar />
          <div className="workspace-viewport">
            {!activeProjectId ? (
              <div id="empty-state" className="empty-state">
                <div className="empty-illustration">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M19 11H5M19 11C20.1046 11 21 11.8954 21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V13C3 11.8954 3.89543 11 5 11M19 11V9C19 7.89543 18.1046 7 17 7M5 11V9C5 7.89543 5.89543 7 7 7M7 7V5C7 3.89543 7.89543 3 9 3H15C16.1046 3 17 3.89543 17 5V7M7 7H17" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h2>No Active Project Selected</h2>
                <p>Select an existing project from the sidebar or create a new project to start scraping patents.</p>
              </div>
            ) : (
              <div className="project-panel">
                <SearchPanel />
                <LiveFeed />
                <HistoryPanel />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Global Modals */}
      <ProjectModal />
      <PatentDetailsModal />
      <FilterModal />
      <SettingsModal />
      <IndiaOptionsModal />
      <CaptchaModal />
      <SavedKeywordsModal />
      <DeleteConfirmModal />
      <InventionModal />

      {/* Toast notifications */}
      <Toast />
    </>
  )
}

