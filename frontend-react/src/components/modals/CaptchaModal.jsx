import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../api/client'

export default function CaptchaModal() {
  const { modals, closeModal, activeCaptchaTaskId, addToast } = useStore()
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const data = modals.captcha
  if (!data) return null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!captchaAnswer.trim() || !activeCaptchaTaskId) return
    setSubmitting(true)
    try {
      const res = await apiClient('/api/india/submit-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: activeCaptchaTaskId, captcha_code: captchaAnswer.trim() }),
      })
      if (!res.ok) throw new Error('CAPTCHA submission failed')
      addToast('CAPTCHA submitted successfully', 'success')
      closeModal('captcha')
      setCaptchaAnswer('')
    } catch (err) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => closeModal('captcha')}>
      <div className="modal modal-captcha" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Indian Patent Search — CAPTCHA Required</h3>
        </div>
        <p className="meta-text" style={{ marginBottom: 12 }}>Please enter the text shown in the image below to solve the CAPTCHA:</p>
        <form onSubmit={handleSubmit}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            {data.image && (
              <img
                src={data.image}
                alt="CAPTCHA"
                style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: '#fff', padding: 4, maxHeight: 60 }}
              />
            )}
          </div>
          <div className="form-group">
            <input
              type="text"
              className="input"
              placeholder="Enter CAPTCHA text"
              value={captchaAnswer}
              onChange={e => setCaptchaAnswer(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit CAPTCHA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
