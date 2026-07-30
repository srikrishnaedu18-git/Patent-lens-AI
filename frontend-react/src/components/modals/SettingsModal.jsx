import { useStore } from '../../store/useStore'

export default function SettingsModal() {
  const store = useStore()
  const { modals, closeModal } = useStore()

  if (!modals.settings) return null

  return (
    <div className="modal-overlay" onClick={() => closeModal('settings')}>
      <div className="modal modal-settings" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings & Preferences</h3>
          <button className="btn-icon" onClick={() => closeModal('settings')}>✕</button>
        </div>

        <div className="form-group">
          <label>Theme</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className={`btn-secondary btn-sm ${store.theme === 'dark' ? 'active' : ''}`} onClick={() => store.setTheme('dark')}>🌙 Dark</button>
            <button className={`btn-secondary btn-sm ${store.theme === 'light' ? 'active' : ''}`} onClick={() => store.setTheme('light')}>☀️ Light</button>
          </div>
        </div>

        <div className="form-group">
          <label>Audit Mode</label>
          <select value={store.auditMode} onChange={e => store.setAuditMode(e.target.value)}>
            <option value="sequential">Sequential (Reliable, step-by-step)</option>
            <option value="batch">Batch (Fast, parallel)</option>
          </select>
        </div>

        <div className="form-group">
          <label>Indian Patents CAPTCHA Mode</label>
          <select value={store.captchaMode} onChange={e => store.setCaptchaMode(e.target.value)}>
            <option value="auto">Auto 2Captcha (API Key required in backend)</option>
            <option value="manual">Manual popup modal</option>
          </select>
        </div>

        <div className="form-group">
          <label>Default Export Format</label>
          <select value={store.currentExportFormatKey} onChange={e => store.setCurrentExportFormatKey(e.target.value)}>
            <option value="md">Markdown (.md)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="json">JSON (.json)</option>
          </select>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-primary" onClick={() => closeModal('settings')}>Done</button>
        </div>
      </div>
    </div>
  )
}
