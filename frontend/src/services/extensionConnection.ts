type Runtime = { sendMessage: (id: string, message: object, callback: (result: Record<string, unknown> | undefined) => void) => void; lastError?: {message?: string} }
const runtime = () => (window as unknown as {chrome?: {runtime?: Runtime}}).chrome?.runtime

export function extensionMessage(id: string, message: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!/^[a-p]{32}$/.test(id) || !runtime()?.sendMessage) { reject(new Error('Open this page in Chrome with the updated JobPilot extension installed.')); return }
    const timer = window.setTimeout(() => reject(new Error('Extension response timed out. Restart the connection from its popup.')), 20000)
    try {
      runtime()!.sendMessage(id, message, result => {
        window.clearTimeout(timer)
        if (runtime()?.lastError || !result?.ok) reject(new Error(typeof result?.error === 'string' ? result.error : 'Extension unavailable. Reload it and start the connection again.'))
        else resolve(result)
      })
    } catch { window.clearTimeout(timer); reject(new Error('Cannot contact the extension. Start again from its popup.')) }
  })
}

export function notifyExtensionSignedOut() {
  const id = localStorage.getItem('jobpilot_extension_id')
  if (id) void extensionMessage(id, {kind: 'platform-signed-out'}).catch(() => { /* Backend revocation remains authoritative. */ })
}

window.addEventListener('storage', event => {
  if (event.key === 'jobpilot_token' && event.oldValue !== event.newValue) notifyExtensionSignedOut()
})
