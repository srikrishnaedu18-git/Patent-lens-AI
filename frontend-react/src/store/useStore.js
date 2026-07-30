import { create } from 'zustand'
import { getIndiaYesterdayDateString } from '../utils/helpers'

const FLOW_STAGES = {
  manual_scrape: ['planning', 'scraping', 'saving', 'complete'],
  ai_search: ['planning', 'scraping', 'saving', 'complete'],
  ai_audit: ['auditing', 'complete'],
  direct_deep_scrape: ['scraping', 'saving', 'complete'],
}
const ALL_STAGES = ['planning', 'scraping', 'auditing', 'saving', 'complete']

const defaultIndiaOptions = {
  published: true, granted: false, date_field: 'APD',
  from_date: '01/01/2020', to_date: getIndiaYesterdayDateString(),
  logic_field: 'AND', rows: [{ field: 'TI', text: '', logic: 'AND' }],
}

const defaultEspacenetOptions = {
  query_lang: 'en',
  rows: [{ field: 'TA', operator: 'all', text: '', logic: 'AND' }],
}

export const useStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  isAuthenticated: null, // null=loading, false=not authed, true=authed
  username: '',

  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setUsername: (username) => set({ username }),

  handleUnauthorized: () => {
    set({
      isAuthenticated: false, username: '',
      projects: [], activeProjectId: null, activeProjectName: '',
      historySearches: [],
    })
  },

  // ── Projects ──────────────────────────────────────────────────────────────
  projects: [],
  activeProjectId: null,
  activeProjectName: '',

  setProjects: (projects) => set({ projects }),
  setActiveProject: (id, name) => set({ activeProjectId: id, activeProjectName: name }),

  // ── Search mode ──────────────────────────────────────────────────────────
  searchMode: 'manual',
  searchSources: (() => {
    try {
      const s = JSON.parse(localStorage.getItem('searchSources') || '["google"]')
      return Array.isArray(s) && s.length ? [s[0]] : ['google']
    } catch { return ['google'] }
  })(),
  allSelectedSources: ['google', 'india', 'espacenet'],
  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchSources: (sources) => {
    localStorage.setItem('searchSources', JSON.stringify(sources))
    set({ searchSources: sources })
  },
  toggleAllSource: (src) => set(s => {
    const curr = s.allSelectedSources
    if (curr.includes(src)) {
      if (curr.length <= 1) return s
      return { allSelectedSources: curr.filter(x => x !== src) }
    }
    return { allSelectedSources: [...curr, src] }
  }),

  // ── India / Espacenet options ─────────────────────────────────────────────
  indiaOptions: (() => {
    try { return JSON.parse(localStorage.getItem('indiaOptions')) || defaultIndiaOptions }
    catch { return defaultIndiaOptions }
  })(),
  espacenetOptions: (() => {
    try { return JSON.parse(localStorage.getItem('espacenetOptions')) || defaultEspacenetOptions }
    catch { return defaultEspacenetOptions }
  })(),
  setIndiaOptions: (opts) => {
    localStorage.setItem('indiaOptions', JSON.stringify(opts))
    set({ indiaOptions: opts })
  },
  setEspacenetOptions: (opts) => {
    localStorage.setItem('espacenetOptions', JSON.stringify(opts))
    set({ espacenetOptions: opts })
  },

  // ── AI search ─────────────────────────────────────────────────────────────
  aiResponse: null,
  aiStep: 'input', // 'input' | 'review'
  setAiResponse: (r) => set({ aiResponse: r, aiStep: r ? 'review' : 'input' }),
  setAiStep: (step) => set({ aiStep: step }),

  // ── History ───────────────────────────────────────────────────────────────
  historySearches: [],
  setHistorySearches: (searches) => set({ historySearches: searches }),

  // ── Filters & search ──────────────────────────────────────────────────────
  filters: { relevancy: [], aiAudit: [], deepScrape: [], source: [] },
  activeFilter: [],
  searchQuery: '',
  setFilters: (filters) => set({ filters, activeFilter: filters.relevancy || [] }),
  resetFilters: () => set({ filters: { relevancy: [], aiAudit: [], deepScrape: [], source: [] }, activeFilter: [] }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  // ── Selection ─────────────────────────────────────────────────────────────
  selectedPatentIds: new Set(),
  selectedSearchIds: new Set(),
  togglePatentSelect: (id, checked) => set(s => {
    const next = new Set(s.selectedPatentIds)
    checked ? next.add(id) : next.delete(id)
    return { selectedPatentIds: next }
  }),
  toggleSearchSelect: (searchId, patentIds, checked) => set(s => {
    const nextSearch = new Set(s.selectedSearchIds)
    const nextPatent = new Set(s.selectedPatentIds)
    if (checked) { nextSearch.add(searchId); patentIds.forEach(id => nextPatent.add(id)) }
    else { nextSearch.delete(searchId); patentIds.forEach(id => nextPatent.delete(id)) }
    return { selectedSearchIds: nextSearch, selectedPatentIds: nextPatent }
  }),
  clearSelection: () => set({ selectedPatentIds: new Set(), selectedSearchIds: new Set() }),
  selectAll: (allPatentIds, allSearchIds) => set({
    selectedPatentIds: new Set(allPatentIds),
    selectedSearchIds: new Set(allSearchIds),
  }),

  // ── Live feed / SSE ───────────────────────────────────────────────────────
  showLiveFeed: false,
  liveLogs: [],
  stagePills: { planning: 'skipped', scraping: 'skipped', auditing: 'skipped', saving: 'skipped', complete: 'skipped' },
  auditProgress: { show: false, current: 0, total: 0, pct: 0, text: '' },
  noveltyData: { red: [], yellow: [], green: [] },
  showNovelty: false,
  activeFlow: null,
  activeTaskId: null,
  lastSSEStage: null,
  isScraping: false,
  isAuditRunning: false,
  isDeepScrapeRunning: false,
  isTerminateVisible: false,

  setShowLiveFeed: (v) => set({ showLiveFeed: v }),
  addLogLine: (text, type = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    set(s => ({ liveLogs: [...s.liveLogs, { text, type, time, id: Date.now() + Math.random() }] }))
  },
  clearLogs: () => set({ liveLogs: [], auditProgress: { show: false, current: 0, total: 0, pct: 0, text: '' }, showNovelty: false, noveltyData: { red: [], yellow: [], green: [] } }),
  updateStagePill: (stage, status) => set(s => ({ stagePills: { ...s.stagePills, [stage]: status } })),
  initStagePillsForFlow: (flowName) => {
    const activeStages = FLOW_STAGES[flowName] || []
    const pills = {}
    ALL_STAGES.forEach(s => { pills[s] = activeStages.includes(s) ? 'waiting' : 'skipped' })
    set({ stagePills: pills, activeFlow: flowName, showNovelty: false, noveltyData: { red: [], yellow: [], green: [] } })
  },
  setAuditProgress: (progress) => set({ auditProgress: progress }),
  addNoveltyEntry: (entry) => set(s => {
    const label = entry.relevancy_label
    const key = label === 'Red' ? 'red' : label === 'Yellow' ? 'yellow' : 'green'
    return { showNovelty: true, noveltyData: { ...s.noveltyData, [key]: [...s.noveltyData[key], entry] } }
  }),
  setActiveTask: (taskId, flow) => set({ activeTaskId: taskId, activeFlow: flow, lastSSEStage: null }),
  setLastSSEStage: (stage) => set({ lastSSEStage: stage }),
  setIsScraping: (v) => set({ isScraping: v }),
  setIsAuditRunning: (v) => set({ isAuditRunning: v }),
  setIsDeepScrapeRunning: (v) => set({ isDeepScrapeRunning: v }),
  setIsTerminateVisible: (v) => set({ isTerminateVisible: v }),

  // ── Settings ──────────────────────────────────────────────────────────────
  theme: (() => localStorage.getItem('pl-user-theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))(),
  auditMode: 'sequential',
  captchaMode: 'auto',
  captchaService: '2captcha',
  activeCaptchaTaskId: null,
  activeRequirement: (() => localStorage.getItem('inventionDescription') || '')(),
  lastScrapedKeywords: '',
  downloadMode: 'all',
  currentExportFormatKey: localStorage.getItem('preferred_export_format') || 'md',

  setTheme: (theme) => {
    localStorage.setItem('pl-user-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    document.body.classList.toggle('light-theme', theme === 'light')
    set({ theme })
  },
  setAuditMode: (mode) => set({ auditMode: mode }),
  setCaptchaMode: (mode) => set({ captchaMode: mode }),
  setCaptchaService: (svc) => set({ captchaService: svc }),
  setActiveCaptchaTaskId: (id) => set({ activeCaptchaTaskId: id }),
  setActiveRequirement: (req) => {
    localStorage.setItem('inventionDescription', req)
    set({ activeRequirement: req })
  },
  setLastScrapedKeywords: (kw) => set({ lastScrapedKeywords: kw }),
  setCurrentExportFormatKey: (key) => {
    localStorage.setItem('preferred_export_format', key)
    set({ currentExportFormatKey: key })
  },

  // ── Modals ────────────────────────────────────────────────────────────────
  modals: {
    project: false, settings: false, filter: false, invention: false,
    savedKeywords: false, patentDetails: null, alert: null,
    deleteConfirm: null, indiaOptions: false, captcha: false, exportLoading: false,
  },
  openModal: (name, data = true) => set(s => ({ modals: { ...s.modals, [name]: data } })),
  closeModal: (name) => set(s => ({ modals: { ...s.modals, [name]: false } })),

  // ── Toast notifications ───────────────────────────────────────────────────
  toasts: [],
  addToast: (message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random()
    set(s => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    return id
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // ── Scraping keywords input (for populating after stop) ──────────────────
  googleKeywordsValue: '',
  setGoogleKeywordsValue: (v) => set({ googleKeywordsValue: v }),
}))
