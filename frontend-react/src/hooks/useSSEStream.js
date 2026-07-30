import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { useQueryClient } from '@tanstack/react-query'

const FLOW_STAGES = {
  manual_scrape: ['planning', 'scraping', 'saving', 'complete'],
  ai_search: ['planning', 'scraping', 'saving', 'complete'],
  ai_audit: ['auditing', 'complete'],
  direct_deep_scrape: ['scraping', 'saving', 'complete'],
}
const STAGES_ORDER = ['planning', 'scraping', 'auditing', 'saving', 'complete']

export function useSSEStream() {
  const store = useStore()
  const qc = useQueryClient()
  const esRef = useRef(null)
  const onCompleteRef = useRef(null)

  const handleStageUpdate = useCallback((data, taskId) => {
    const { stage, message, current, total } = data

    if (data.reset_pipeline) {
      store.initStagePillsForFlow(store.activeFlow || 'manual_scrape')
    }

    // Update stage pills
    if (stage) {
      const currentIdx = STAGES_ORDER.indexOf(stage)
      store.updateStagePill(stage, 'active')
      const activeStages = FLOW_STAGES[store.activeFlow] || []
      if (currentIdx !== -1) {
        for (let i = 0; i < currentIdx; i++) {
          if (activeStages.includes(STAGES_ORDER[i])) {
            store.updateStagePill(STAGES_ORDER[i], 'done')
          }
        }
      }
    }

    // Log message
    if (message) {
      let type = 'info'
      if (message.includes('✅')) type = 'success'
      if (message.includes('❌')) type = 'error'
      if (message.includes('⚠️') || message.includes('⛔')) type = 'warning'
      store.addLogLine(message, type)
    }

    // CAPTCHA image in log
    if (data.captcha_image && stage !== 'captcha') {
      store.addLogLine('__captcha_image__:' + data.captcha_image, 'info')
    }

    // CAPTCHA modal
    if (stage === 'captcha' && data.captcha_image) {
      store.setActiveCaptchaTaskId(taskId)
      store.openModal('captcha', { image: data.captcha_image })
    } else if (['complete', 'error', 'saving', 'auditing'].includes(stage)) {
      store.closeModal('captcha')
    }

    // Audit progress
    if (stage === 'auditing' && total > 0) {
      const progressVal = current || 0
      const pct = Math.round((progressVal / total) * 100)
      store.setAuditProgress({ show: true, current: progressVal, total, pct, text: `Auditing Patents: ${progressVal}/${total}` })
      if (data.patent_id && data.relevance_category) {
        // live update novelty
        store.addNoveltyEntry(data)
      }
    }

    // Complete
    if (stage === 'complete') {
      const activeStages = FLOW_STAGES[store.activeFlow] || []
      activeStages.forEach(s => store.updateStagePill(s, 'done'))

      if (data.terminated && data.remaining_keywords?.length > 0) {
        store.addLogLine(`⛔ Scrape terminated. Loaded ${data.remaining_keywords.length} remaining keywords back.`, 'warning')
        store.setGoogleKeywordsValue(data.remaining_keywords.join(', '))
      } else {
        if (store.activeFlow === 'manual_scrape') store.addLogLine('🎉 Manual Scrape Finished Successfully!', 'success')
        else store.addLogLine('🎉 Agent Pipeline Finished Successfully!', 'success')
      }

      if (store.activeFlow === 'manual_scrape' && data.scraped?.length > 0) {
        const validRuns = data.scraped.filter(r => r.search_id)
        if (validRuns.length > 0) {
          const kw = validRuns.map(r => r.keyword).join(', ')
          store.setLastScrapedKeywords(kw)
          if (!store.activeRequirement) store.setActiveRequirement(kw)
          store.addLogLine('Scraping complete. Select patents then use AI Audit button.', 'info')
        }
      } else if (store.activeFlow === 'ai_audit') {
        store.addLogLine('💡 Relevance assessment completed. Study the Novelty & Relevancy Dashboard below.', 'info')
      }

      store.setIsScraping(false)
      store.setIsAuditRunning(false)
      store.setIsDeepScrapeRunning(false)
      store.setIsTerminateVisible(false)

      // Refresh history
      if (store.activeProjectId) {
        qc.invalidateQueries({ queryKey: ['history', store.activeProjectId] })
      }

      if (store.activeFlow === 'ai_search') {
        setTimeout(() => store.setAiStep('input'), 4000)
      }
    }

    // Error
    if (stage === 'error') {
      store.updateStagePill('complete', 'error')
      store.addLogLine(`❌ Critical Pipeline Error: ${message}`, 'error')
      store.setIsScraping(false)
      store.setIsAuditRunning(false)
      store.setIsDeepScrapeRunning(false)
      store.addToast(`Pipeline Error: ${message}`, 'error')
    }
  }, [store, qc])

  const start = useCallback((taskId, onComplete = null) => {
    // Close any existing stream
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    onCompleteRef.current = onComplete
    store.setActiveTask(taskId, store.activeFlow)

    const es = new EventSource(`/api/ai/stream/${taskId}`)
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.stage) store.setLastSSEStage(data.stage)
        handleStageUpdate(data, taskId)
        if (data.stage === 'complete' || data.stage === 'error') {
          es.close()
          esRef.current = null
          if (typeof onCompleteRef.current === 'function') {
            onCompleteRef.current()
            onCompleteRef.current = null
          }
        }
      } catch (err) {
        console.error('SSE parse error:', err)
      }
    }

    es.onerror = () => {
      if (!esRef.current) return
      const succeeded = store.lastSSEStage === 'complete'
      if (succeeded) {
        store.addLogLine('✅ Scrape completed successfully. Stream closed.', 'success')
      } else {
        store.addLogLine('❌ Stream disconnected unexpectedly. Scrape may have failed.', 'error')
      }
      es.close()
      esRef.current = null
      store.setIsScraping(false)
      store.setIsAuditRunning(false)
      store.setIsDeepScrapeRunning(false)
      store.setIsTerminateVisible(false)
      if (typeof onCompleteRef.current === 'function') {
        onCompleteRef.current()
        onCompleteRef.current = null
      }
    }
  }, [store, handleStageUpdate])

  const stop = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { if (esRef.current) esRef.current.close() }, [])

  return { start, stop }
}
