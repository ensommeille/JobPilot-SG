export function sourceTime(value: string | null | undefined): string {
  if (!value) return 'Not checked yet'
  const withZone = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z'
  const date = new Date(withZone)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' SGT'
}
