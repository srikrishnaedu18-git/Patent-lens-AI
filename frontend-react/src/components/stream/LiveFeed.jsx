import { useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../api/client'

export default function LiveFeed() {
  const { showLiveFeed, liveLogs, stagePills, auditProgress, noveltyData, showNovelty,
          isTerminateVisible, activeTaskId, addToast, isScraping } = useStore()
  const logEndRef = useRef(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveLogs])

  if (!showLiveFeed) return null

  async function handleTerminate() {
    if (!activeTaskId) return
    if (!confirm('Are you sure you want to stop the scrape? Remaining keywords will be loaded back into the input bar.')) return
    try {
      const res = await apiClient(`/api/scrape/cancel/${activeTaskId}`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); addToast(`Could not stop scrape: ${e.detail || 'Unknown error'}`, 'error'); return }
      useStore.getState().addLogLine('⛔ Stop request sent. Waiting for current keyword scrape to finish...', 'warning')
    } catch (err) {
      addToast('Error sending stop request', 'error')
    }
  }

  return (
    <div id="live-feed" className="live-feed">
      <div className="live-feed-header">
        <div className="live-feed-title">
          <span className="pulse-dot"></span>
          Live Pipeline Log
        </div>
        <div className="live-feed-header-right" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="stage-pills" id="stage-pills">
            {['planning','scraping','auditing','saving','complete'].map(stage => (
              <StagePill key={stage} stage={stage} status={stagePills[stage]} />
            ))}
          </div>
          {isTerminateVisible && (
            <button id="btn-terminate-scrape" className="btn-danger btn-sm btn-terminate" onClick={handleTerminate}>
              ⛔ Stop
            </button>
          )}
        </div>
      </div>


      {/* Audit Progress Bar */}
      {auditProgress.show && (
        <div id="audit-progress-bar-wrap" className="audit-progress-wrap">
          <div className="audit-progress-labels">
            <span id="audit-progress-text">{auditProgress.text}</span>
            <span id="audit-progress-pct">{auditProgress.pct}%</span>
          </div>
          <div className="audit-progress-track">
            <div id="audit-progress-bar" className="audit-progress-bar" style={{ width: `${auditProgress.pct}%` }} />
          </div>
        </div>
      )}

      {/* Log output */}
      <div id="live-log" className="live-log">
        {liveLogs.map(log => {
          if (log.text.startsWith('__captcha_image__:')) {
            const src = log.text.replace('__captcha_image__:', '')
            return (
              <div key={log.id} className="log-line log-info">
                <span className="log-time">[{log.time}]</span>
                <span className="log-text">Captured CAPTCHA Image:</span>
                <img src={src} alt="CAPTCHA" style={{ display: 'block', maxHeight: 50, maxWidth: 200, marginTop: 4, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: '#fff', padding: 2 }} />
              </div>
            )
          }
          return (
            <div key={log.id} className={`log-line log-${log.type}`}>
              <span className="log-time">[{log.time}]</span>
              <span className="log-text">{log.text}</span>
            </div>
          )
        })}
        <div ref={logEndRef} />
      </div>

      {/* Novelty Dashboard */}
      {showNovelty && <NoveltyDashboard data={noveltyData} />}
    </div>
  )
}

function StagePill({ stage, status }) {
  if (!status || status === 'skipped') return null
  const labels = { planning: 'Planning', scraping: 'Scraping', auditing: 'Auditing', saving: 'Saving', complete: 'Complete' }
  return (
    <span className={`stage-pill ${status}`}>{labels[stage] || stage}</span>
  )
}

function NoveltyDashboard({ data }) {
  const { escapeHtml: _ } = {}
  return (
    <div id="novelty-results-panel" className="novelty-results-panel">
      <h4 className="novelty-panel-title">Novelty & Relevancy Dashboard</h4>
      <div className="novelty-columns">
        <NoveltyColumn title="🔴 No/Low Novelty" colorClass="red" items={data.red} />
        <NoveltyColumn title="🟡 Moderate Novelty" colorClass="yellow" items={data.yellow} />
        <NoveltyColumn title="🟢 High Novelty" colorClass="green" items={data.green} />
      </div>
    </div>
  )
}

function NoveltyColumn({ title, colorClass, items }) {
  return (
    <div className={`novelty-column novelty-column--${colorClass}`}>
      <div className="novelty-column-header">{title} <span className="novelty-count">({items.length})</span></div>
      <div className="novelty-list">
        {items.map((p, i) => {
          const noveltyPercent = Math.round((1 - p.confidence_score) * 100)
          return (
            <div key={i} className="novelty-card">
              <div className="novelty-card-header">
                <a href={p.patent_url || '#'} target="_blank" rel="noreferrer" className="novelty-link">
                  {p.patent_code || 'Patent'}
                  <svg style={{ width: 10, height: 10, marginLeft: 2 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
                </a>
                <span className={`novelty-score-badge novelty-score-badge--${colorClass}`}>
                  {colorClass === 'red' ? 'No/Low Novelty' : colorClass === 'yellow' ? 'Moderate Novelty' : 'High Novelty'}
                </span>
              </div>
              <h5 className="novelty-title">{p.title}</h5>
              <div className="novelty-bar-wrap">
                <div className={`novelty-bar-fill novelty-bar-fill--${colorClass}`} style={{ width: `${noveltyPercent}%` }} />
              </div>
              <div style={{ fontSize: '0.72rem', textAlign: 'right', color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
                Novelty Score: {noveltyPercent}%
              </div>
              {p.reasoning && <div className="novelty-reasoning"><strong>Gemini:</strong> {p.reasoning}</div>}
            </div>
          )
        })}
        {items.length === 0 && <div className="meta-text" style={{ padding: 12, textAlign: 'center' }}>None yet</div>}
      </div>
    </div>
  )
}
