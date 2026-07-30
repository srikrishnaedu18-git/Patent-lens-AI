import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { INDIA_SEARCH_FIELDS_MAP } from '../../utils/helpers'

const MAX_ROWS = 5

export default function IndiaQueryBuilder({ onRowsChange, disabled }) {
  const { indiaOptions } = useStore()
  const [rows, setRows] = useState(
    indiaOptions?.rows?.length ? indiaOptions.rows : [{ field: 'TI', text: '', logic: 'AND' }]
  )

  useEffect(() => { onRowsChange?.(rows) }, [rows])

  function addRow() {
    if (rows.length >= MAX_ROWS) { useStore.getState().addToast('Maximum of 5 query rows is allowed.', 'warning'); return }
    setRows(r => [...r, { field: 'TI', text: '', logic: 'AND' }])
  }
  function removeRow(idx) {
    if (rows.length <= 1) { useStore.getState().addToast('At least one query row is required.', 'warning'); return }
    setRows(r => r.filter((_, i) => i !== idx))
  }
  function updateRow(idx, key, val) {
    setRows(r => r.map((row, i) => i === idx ? { ...row, [key]: val } : row))
  }

  return (
    <div>
      <div id="manual-india-query-rows-container" className="india-query-rows">
        {rows.map((row, idx) => (
          <div key={idx} className="india-query-row">
            <select className="row-field" value={row.field} disabled={disabled} onChange={e => updateRow(idx, 'field', e.target.value)}>
              {Object.entries(INDIA_SEARCH_FIELDS_MAP).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input type="text" className="row-text" placeholder="Query term (e.g. COMPUTER IMPLEMENTED)" value={row.text} disabled={disabled} onChange={e => updateRow(idx, 'text', e.target.value)} />
            <select className="row-logic" value={row.logic} disabled={disabled} onChange={e => updateRow(idx, 'logic', e.target.value)}>
              {['AND','OR','NOT'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="button" className="btn-remove-row" disabled={disabled} onClick={() => removeRow(idx)} title="Remove Row">
              <svg className="icon-sm" viewBox="0 0 24 24" fill="none"><path d="M19 7L5 7M10 11V17M14 11V17M12 3L12 4M19 7L18 20C18 20.5523 17.5523 21 17 21H7C6.44772 21 6 20.5523 6 20L5 7M10 3L14 3C14.5523 3 15 3.44772 15 4V7H9V4C9 3.44772 9.44772 3 10 3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        ))}
      </div>
      <div className="row-actions">
        <button type="button" id="btn-manual-india-add-row" className="btn-secondary btn-sm" disabled={disabled} onClick={addRow}>+ Add Row</button>
        <button type="button" id="btn-india-options" className="btn-secondary btn-sm" disabled={disabled} onClick={() => useStore.getState().openModal('indiaOptions')}>⚙ Date Options</button>
      </div>
    </div>
  )
}
