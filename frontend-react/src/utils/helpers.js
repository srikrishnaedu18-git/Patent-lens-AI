// ── Utility helpers (ported from original app.js) ────────────────────────────

export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return String(text ?? '').replace(/[&<>"']/g, m => map[m])
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function formatErrorDetail(detail, fallback) {
  if (!detail) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map(d => {
      const locStr = d.loc ? d.loc.join('.') : ''
      return locStr ? `${locStr}: ${d.msg}` : d.msg
    }).join('; ')
  }
  if (typeof detail === 'object') {
    try { return JSON.stringify(detail) } catch { return fallback }
  }
  return String(detail) || fallback
}

export function parseUtcDate(dateStr) {
  if (!dateStr) return new Date()
  if (dateStr.includes('Z') || dateStr.includes('+') ||
    (dateStr.includes('-') && dateStr.length > 10 && dateStr.includes('T'))) {
    return new Date(dateStr)
  }
  return new Date(dateStr + ' UTC')
}

export function scoreToRelevancy(score) {
  if (score === null || score === undefined) return 'Unaudited'
  if (score >= 0.75) return 'Red'
  if (score >= 0.4) return 'Yellow'
  return 'Green'
}

export function getIndiaYesterdayDateString() {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istYesterday = new Date(now.getTime() + istOffset - 86400000)
  const dd = String(istYesterday.getUTCDate()).padStart(2, '0')
  const mm = String(istYesterday.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = istYesterday.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}

export function getTodayDateString() {
  const today = new Date()
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const yyyy = today.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

export function formatDate(dateStr) {
  const d = parseUtcDate(dateStr)
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export const INDIA_SEARCH_FIELDS_MAP = {
  TI: 'Title', ABS: 'Abstract', CSP: 'Complete Specification',
  AP: 'Application Number', PN: 'Publication Number',
  'patent-number': 'Patent Number', PA: 'Applicant Name',
  ANC: 'Applicant Country', ANA: 'Applicant Address',
  IN: 'Inventor Name', INC: 'Inventor Country', INA: 'Inventor Address',
  FO: 'Filing Office', IC: 'International Classification',
  PAP: 'Patent Application Publication', PPN: 'PCT Publication Number',
}

export const ESPACENET_SEARCH_FIELDS_MAP = {
  TI: { label: 'Title', defaultOperator: 'all', placeholder: 'e.g. quantum computing' },
  TA: { label: 'Title or abstract', defaultOperator: 'all', placeholder: 'e.g. neural network' },
  PN: { label: 'Publication number', defaultOperator: 'any', placeholder: 'e.g. EP1234567' },
  AP: { label: 'Application number', defaultOperator: 'any', placeholder: 'e.g. EP2020012345' },
  PR: { label: 'Priority number', defaultOperator: 'any', placeholder: 'e.g. US201962800000' },
  PD: { label: 'Publication date', defaultOperator: '=', placeholder: 'e.g. 2023 or 2020:2024' },
  PA: { label: 'Applicants', defaultOperator: 'any', placeholder: 'e.g. Siemens, IBM' },
  IN: { label: 'Inventors', defaultOperator: 'any', placeholder: 'e.g. Smith John' },
  CPC: { label: 'CPC classification', defaultOperator: 'any', placeholder: 'e.g. H04L67/10' },
  IPC: { label: 'IPC classification', defaultOperator: 'any', placeholder: 'e.g. G01N33/50' },
}

export function buildEspacenetQuery(rows) {
  const parts = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.text) continue
    let textVal = r.text.replace(/"/g, '').trim()
    const f = (r.field || 'txt').toLowerCase()
    const op = r.operator || 'all'
    let part = ''
    if (f === 'ta') {
      if (op === 'all' && textVal.includes(' ')) {
        const words = textVal.split(/\s+/).filter(Boolean)
        part = `((${words.map(w => `ti="${w}"`).join(' and ')}) or (${words.map(w => `ab="${w}"`).join(' and ')}))`
      } else if (op === 'any' && textVal.includes(' ')) {
        const words = textVal.split(/\s+/).filter(Boolean)
        part = `((${words.map(w => `ti="${w}"`).join(' or ')}) or (${words.map(w => `ab="${w}"`).join(' or ')}))`
      } else {
        part = `(ti="${textVal}" or ab="${textVal}")`
      }
    } else {
      if (op === 'all' && textVal.includes(' ')) {
        part = `(${textVal.split(/\s+/).filter(Boolean).map(w => `${f}="${w}"`).join(' and ')})`
      } else if (op === 'any' && textVal.includes(' ')) {
        part = `(${textVal.split(/\s+/).filter(Boolean).map(w => `${f}="${w}"`).join(' or ')})`
      } else {
        part = `${f}="${textVal}"`
      }
    }
    if (parts.length > 0) parts.push(`${r.logic} ${part}`)
    else parts.push(part)
  }
  return parts.join(' ')
}
