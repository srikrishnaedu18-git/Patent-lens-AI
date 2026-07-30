import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { getIndiaYesterdayDateString } from '../../utils/helpers'

export default function IndiaOptionsModal() {
  const { modals, closeModal, indiaOptions, setIndiaOptions } = useStore()

  const [published, setPublished] = useState(indiaOptions?.published ?? true)
  const [granted, setGranted] = useState(indiaOptions?.granted ?? false)
  const [dateField, setDateField] = useState(indiaOptions?.date_field || 'APD')
  const [fromDate, setFromDate] = useState(indiaOptions?.from_date || '01/01/2020')
  const [toDate, setToDate] = useState(indiaOptions?.to_date || getIndiaYesterdayDateString())

  if (!modals.indiaOptions) return null

  function handleSave() {
    setIndiaOptions({
      ...indiaOptions,
      published,
      granted,
      date_field: dateField,
      from_date: fromDate,
      to_date: toDate,
    })
    closeModal('indiaOptions')
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('indiaOptions')}>
      <div className="modal modal-india-options" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Indian Patents Date & Filter Options</h3>
          <button className="btn-icon" onClick={() => closeModal('indiaOptions')}>✕</button>
        </div>

        <div className="form-group">
          <label>Document Types</label>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />
              <span>Published Applications</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={granted} onChange={e => setGranted(e.target.checked)} />
              <span>Granted Patents</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label>Date Filter Field</label>
          <select value={dateField} onChange={e => setDateField(e.target.value)}>
            <option value="APD">Application Filing Date (APD)</option>
            <option value="PY">Publication Date (PY)</option>
            <option value="GRD">Grant Date (GRD)</option>
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>From Date (MM/DD/YYYY)</label>
            <input type="text" className="input" placeholder="01/01/2020" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To Date (MM/DD/YYYY)</label>
            <input type="text" className="input" placeholder="MM/DD/YYYY" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={() => closeModal('indiaOptions')}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave}>Save Options</button>
        </div>
      </div>
    </div>
  )
}
