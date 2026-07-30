import { useStore } from '../../store/useStore'
import ManualSearch from './ManualSearch'
import AiSearch from './AiSearch'

export default function SearchPanel() {
  const { searchMode, setSearchMode, openModal, activeRequirement } = useStore()

  return (
    <section className="control-card">
      <div className="mode-toggle-bar">
        <div className="mode-toggle-group" role="group" aria-label="Search mode">
          <button
            id="btn-mode-manual"
            className={`mode-btn ${searchMode === 'manual' ? 'active' : ''}`}
            onClick={() => setSearchMode('manual')}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Manual Keywords
          </button>
          <button
            id="btn-mode-ai"
            className={`mode-btn ${searchMode === 'ai' ? 'active' : ''}`}
            onClick={() => setSearchMode('ai')}
          >
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            AI Auto-Generate
          </button>
        </div>

        <button
          id="btn-open-invention-modal"
          type="button"
          className="btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 500 }}
          onClick={() => openModal('invention')}
          title="Describe your invention in detail for AI Audit comparisons"
        >
          <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Describe Invention</span>
          {activeRequirement && (
            <span id="invention-status-badge" style={{ width: 8, height: 8, backgroundColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block' }} />
          )}
        </button>
      </div>

      <div id="panel-manual" className={`search-panel ${searchMode !== 'manual' ? 'hidden' : ''}`}>
        <ManualSearch />
      </div>
      <div id="panel-ai" className={`search-panel ${searchMode !== 'ai' ? 'hidden' : ''}`}>
        <AiSearch />
      </div>
    </section>
  )
}

