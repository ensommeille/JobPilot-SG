export interface AutomaticAnalysisResult {
  status: 'confirmed' | 'failed' | 'uncertain' | 'already_started' | 'cancelled'
  error?: unknown
}

interface Dependencies {
  digest: (value: string) => Promise<string>
  readMarker: (key: string) => string | null
  writeMarker: (key: string) => void
  start: (token: string, jobId: string, signal: AbortSignal) => Promise<{ status: string }>
}

// A started marker contains no profile, token or result. It also survives reloads,
// when an interrupted POST may already have reached the provider.
export class JobAnalysisCoordinator {
  private entries = new Map<string, { token: string; controller: AbortController; promise: Promise<AutomaticAnalysisResult> }>()
  private dependencies: Dependencies

  constructor(dependencies: Dependencies) { this.dependencies = dependencies }

  rememberUnavailable(token: string, jobId: string, contextHash: string) {
    const key = JSON.stringify([token, jobId, contextHash])
    if (this.entries.has(key)) return
    const controller = new AbortController()
    const promise = Promise.resolve().then(async (): Promise<AutomaticAnalysisResult> => {
      try {
        const marker = 'jobpilot:job-fit:' + await this.dependencies.digest(key)
        this.dependencies.writeMarker(marker)
      } catch { /* Memory still blocks an automatic retry in this session. */ }
      return { status: 'failed' }
    })
    this.entries.set(key, { token, controller, promise })
  }

  ensure(token: string, jobId: string, contextHash: string): Promise<AutomaticAnalysisResult> {
    const key = JSON.stringify([token, jobId, contextHash])
    const existing = this.entries.get(key)
    if (existing) return existing.promise
    const controller = new AbortController()
    const promise = Promise.resolve().then(async (): Promise<AutomaticAnalysisResult> => {
      try {
        const marker = 'jobpilot:job-fit:' + await this.dependencies.digest(key)
        if (controller.signal.aborted) return { status: 'cancelled' }
        if (this.dependencies.readMarker(marker)) return { status: 'already_started' }
        this.dependencies.writeMarker(marker)
        const run = await this.dependencies.start(token, jobId, controller.signal)
        if (controller.signal.aborted) return { status: 'cancelled' }
        return { status: run.status === 'failed' ? 'failed' : 'confirmed' }
      } catch (error) {
        return controller.signal.aborted ? { status: 'cancelled' } : { status: 'uncertain', error }
      }
    })
    this.entries.set(key, { token, controller, promise })
    return promise
  }

  cancelOtherSessions(token: string | null) {
    for (const entry of this.entries.values()) if (entry.token !== token) entry.controller.abort()
  }
}
