import { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { ESPACENET_SEARCH_FIELDS_MAP } from '../../utils/helpers'

const OPERATORS = [{ val: 'all', label: 'all of' }, { val: 'any', label: 'any of' }, { val: '=', label: 'equals' }]

export default function EspacenetQueryBuilder({ onRowsChange, disabled }) {
  const { espacenetOptions } = useStore()
  const [lang, setLang] = useState(espacenetOptions?.query_lang || 'en')
  const [rows, setRows] = useState(
    espacenetOptions?.rows?.length ? espacenetOptions.rows : [{ field: 'TA', operator: 'all', text: '', logic: 'AND' }]
  )

  useEffect(() => { onRowsChange?.(rows) }, [rows])

  function addRow() {
    setRows(r => [...r, { field: 'TI', operator: 'all', text: '', logic: 'AND' }])
  }
  function removeRow(idx) {
    if (rows.length <= 1) { useStore.getState().addToast('At least one query row is required.', 'warning'); return }
    setRows(r => r.filter((_, i) => i !== idx))
  }
  function updateRow(idx, key, val) {
    setRows(r => r.map((row, i) => {
      if (i !== idx) return row
      const updated = { ...row, [key]: val }
      if (key === 'field') updated.operator = ESPACENET_SEARCH_FIELDS_MAP[val]?.defaultOperator || 'all'
      return updated
    }))
  }
  function reset() {
    setRows([{ field: 'TA', operator: 'all', text: '', logic: 'AND' }])
    setLang('en')
  }

  return (
    <div>
      <div className="form-row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
        <label htmlFor="espacenet-opt-lang" style={{ margin: 0 }}>Language:</label>
        <select id="espacenet-opt-lang" value={lang} disabled={disabled} onChange={e => setLang(e.target.value)} style={{ width: 'auto' }}>
          {[['en','English(en)'],['de','German(de)'],['fr','French(fr)']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div id="manual-espacenet-query-rows-container" className="espacenet-query-rows">
        {rows.map((row, idx) => (
          <div key={idx} className="espacenet-query-row">
            <select className="row-field" value={row.field} disabled={disabled} onChange={e => updateRow(idx, 'field', e.target.value)}>
              {Object.entries(ESPACENET_SEARCH_FIELDS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select className="row-operator" value={row.operator} disabled={disabled} onChange={e => updateRow(idx, 'operator', e.target.value)}>
              {OPERATORS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
            <input type="text" className="row-text" placeholder={ESPACENET_SEARCH_FIELDS_MAP[row.field]?.placeholder || 'Search term...'} value={row.text} disabled={disabled} onChange={e => updateRow(idx, 'text', e.target.value)} />
            <select className="row-logic" value={row.logic} disabled={disabled} onChange={e => updateRow(idx, 'logic', e.target.value)}>
              {['AND','OR','NOT'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="button" className="btn-remove-row" disabled={disabled} onClick={() => removeRow(idx)} title="Remove">
              <svg className="icon-sm" viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="row-actions">
        <button type="button" id="btn-manual-espacenet-add-row" className="btn-secondary btn-sm" disabled={disabled} onClick={addRow}>+ Add Row</button>
        <button type="button" id="btn-manual-espacenet-reset" className="btn-secondary btn-sm" disabled={disabled} onClick={reset}>Reset</button>
      </div>
    </div>
  )
}
