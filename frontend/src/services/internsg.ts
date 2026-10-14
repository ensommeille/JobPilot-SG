export function internsgApplicationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['internsg.com', 'www.internsg.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && /^\/job-apply\/[0-9]+\/?$/.test(url.pathname) ? url.href : null
  } catch { return null }
}
