import { useEffect, useState } from 'react'
import { getToken, watchSession } from '../services/auth'
import { fetchAutofillProfile, type AutofillProfile } from '../services/autofill'
import { warmPreparedAnswers, type PreparedAnswers } from '../services/preparedAnswers'

export function useApplicationFacts(token: string | null, enabled: boolean, revision = 0) {
  const [loaded, setLoaded] = useState<{ token: string; revision: number; profile: AutofillProfile } | null>(null)
  useEffect(() => {
    if (!token || !enabled || getToken() !== token) return
    const request = new AbortController()
    fetchAutofillProfile({ signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      .then(result => {
        if (!request.signal.aborted && getToken() === token && result.data.fingerprint) setLoaded({ token, revision, profile: result.data })
      })
      .catch(() => { /* Saved Profile remains usable when this optional free read fails. */ })
    return () => request.abort()
  }, [token, enabled, revision])
  return enabled && loaded?.token === token && loaded.revision === revision ? loaded.profile : null
}

interface Entry {
  token: string
  controller: AbortController
  promise: Promise<PreparedAnswers | null>
  settled: boolean
}
const entries = new Map<string, Entry>()
let watching = false

function waitForCache(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = window.setTimeout(finish, milliseconds)
    const abort = () => { window.clearTimeout(timer); reject(new Error('Preparation cancelled.')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function preparationEntry(key: string, token: string, jobId: string, profile: AutofillProfile): Entry {
  const cached = entries.get(key)
  if (cached && !cached.settled) return cached
  // The extension must see the real questions before starting model work.
  // Platform preparation only reads an existing cache; generic warm-up must not
  // occupy the same context while the actual form is being analyzed.
  if (!watching) {
    watching = true
    watchSession(() => {
      for (const [key, entry] of entries) if (entry.token !== getToken()) {
        entry.controller.abort()
        entries.delete(key)
      }
    })
  }
  const controller = new AbortController()
  const deadline = Date.now() + 8200
  const timer = window.setTimeout(() => controller.abort(), 8200)
  const payload = { job_id: jobId, profile_fingerprint: profile.fingerprint, ...(profile.resume ? { resume_id: profile.resume.id } : {}) }
  const config = { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } }
  const read = async () => {
    const remaining = deadline - Date.now()
    if (remaining <= 0 || controller.signal.aborted) throw new Error('Preparation time limit reached.')
    const response = await warmPreparedAnswers({ ...payload, cache_only: true }, { ...config, timeout: remaining })
    if (response.data.profile_fingerprint !== profile.fingerprint || response.data.resume_id !== (profile.resume?.id ?? null)) throw new Error('Saved answers changed.')
    return response.data
  }
  const promise = (async () => {
    try {
      let result = await read()
      while (result.status === 'preparing' && Date.now() + 1250 < deadline) {
        await waitForCache(controller.signal, 1250)
        try { result = await read() }
        catch { break } // A cache-read failure never starts another paid request.
      }
      return result
    } catch { return null }
    finally { window.clearTimeout(timer) }
  })()
  const entry = { token, controller, promise, settled: false }
  void promise.finally(() => { entry.settled = true })
  entries.set(key, entry)
  return entry
}

export interface ApplicationPreparationState {
  phase: 'idle' | 'preparing' | 'waiting' | 'ready' | 'partial' | 'unavailable' | 'pdf_mismatch' | 'pdf_selection'
  report: PreparedAnswers | null
  resumeName: string | null
}

export function usePreparedAnswers({ token, jobId, profile, enabled, attachmentResumeId }: {
  token: string | null; jobId: string; profile: AutofillProfile | null; enabled: boolean; attachmentResumeId?: string | null
}): ApplicationPreparationState {
  const mismatch = !!profile && attachmentResumeId !== undefined && attachmentResumeId !== (profile.resume?.id ?? null)
  const canPrepare = enabled && token && profile && !mismatch && !profile.requires_resume_selection
  const key = canPrepare ? JSON.stringify([token, jobId, profile.fingerprint]) : ''
  const [loaded, setLoaded] = useState<{ key: string; report: PreparedAnswers | null } | null>(null)
  if (loaded && loaded.key !== key) setLoaded(null)
  useEffect(() => {
    if (!key || !token || !profile || getToken() !== token) return
    let current = true
    const entry = preparationEntry(key, token, jobId, profile)
    entry.promise.then(report => { if (current && getToken() === token) setLoaded({ key, report }) })
    return () => { current = false }
    // The server fingerprint binds all facts and the selected PDF. Equivalent
    // Profile objects must reuse one request across StrictMode and page returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const report = key && loaded?.key === key ? loaded.report : null
  const phase = !enabled ? 'idle' : mismatch ? 'pdf_mismatch' : profile?.requires_resume_selection ? 'pdf_selection'
    : !profile ? 'idle' : !loaded || loaded.key !== key ? 'preparing' : report?.status === 'preparing' ? 'waiting' : report?.status ?? 'unavailable'
  return { phase, report, resumeName: profile?.resume?.filename ?? null }
}
