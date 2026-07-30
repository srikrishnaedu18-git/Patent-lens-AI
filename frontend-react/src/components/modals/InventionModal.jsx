import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'

export default function InventionModal() {
  const { modals, closeModal, activeRequirement, setActiveRequirement, addToast } = useStore()
  const [desc, setDesc] = useState('')

  const isOpen = modals.invention
  useEffect(() => {
    if (isOpen) setDesc(activeRequirement || '')
  }, [isOpen, activeRequirement])

  if (!isOpen) return null

  function handleSave() {
    setActiveRequirement(desc)
    addToast('Invention description saved!', 'success')
    closeModal('invention')
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('invention')}>
      <div className="modal modal-filter" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Describe Invention
          </h3>
          <button className="btn-icon" onClick={() => closeModal('invention')}>✕</button>
        </div>

        <div className="filter-body">
          <p className="filter-description">
            Provide details of your invention mechanism so the AI audit agent can compare each scraped patent against your concept.
          </p>

          <div className="form-group flex-grow" style={{ marginTop: 12 }}>
            <label htmlFor="manual-description-input" style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 8, display: 'block' }}>
              Invention Description Details
            </label>
            <textarea
              id="manual-description-input"
              rows={6}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              placeholder="Describe your invention in detail so the AI audit can compare each patent against your specific mechanism. E.g. 'A solar-powered drip irrigation controller using soil moisture sensors and IoT connectivity to dynamically regulate water flow...'"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={() => closeModal('invention')}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave}>Save Description</button>
          </div>
        </div>
      </div>
    </div>
  )
}
