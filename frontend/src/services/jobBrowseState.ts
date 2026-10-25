export interface JobBrowseState {
  search: string
  place: string
  types: string[]
  tags: string[]
  locations: string[]
  deadlineDays: number
  salaryOnly: boolean
  sort: 'deadline' | 'newest' | 'salary'
  page: number
}

const defaults = (): JobBrowseState => ({ search: '', place: '', types: [], tags: [], locations: [], deadlineDays: 0, salaryOnly: false, sort: 'deadline', page: 1 })
const fields = ['search', 'place', 'types', 'tags', 'locations', 'deadlineDays', 'salaryOnly', 'sort', 'page']
const text = (value: unknown, length: number): value is string => typeof value === 'string' && value.length <= length
  && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
const choices = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 30 && value.every(item => text(item, 160))

// Only public browse controls are accepted. Profile data, tokens and arbitrary
// return URLs are never stored in this parameter.
export function readJobBrowseState(value: string | null): JobBrowseState {
  if (!value || value.length > 6000) return defaults()
  try {
    const data: unknown = JSON.parse(value)
    if (typeof data !== 'object' || !data || Array.isArray(data)) return defaults()
    const state = data as Record<string, unknown>
    if (Object.keys(state).some(key => !fields.includes(key))
      || !text(state.search, 200) || !text(state.place, 160)
      || !choices(state.types) || !choices(state.tags) || !choices(state.locations)
      || ![0, 7, 14, 30].includes(Number(state.deadlineDays)) || typeof state.deadlineDays !== 'number'
      || typeof state.salaryOnly !== 'boolean' || !['deadline', 'newest', 'salary'].includes(String(state.sort))
      || typeof state.page !== 'number' || !Number.isSafeInteger(state.page) || state.page < 1 || state.page > 1000) return defaults()
    return state as unknown as JobBrowseState
  } catch { return defaults() }
}

export function serializeJobBrowseState(state: JobBrowseState): string {
  const value = JSON.stringify({ search: state.search, place: state.place, types: state.types, tags: state.tags, locations: state.locations,
    deadlineDays: state.deadlineDays, salaryOnly: state.salaryOnly, sort: state.sort, page: state.page })
  return value === JSON.stringify(defaults()) ? '' : value
}

export function jobDetailLocation(jobId: string | number, browse: string | null, runId?: string): string {
  const query = new URLSearchParams()
  const safeBrowse = serializeJobBrowseState(readJobBrowseState(browse))
  if (safeBrowse) query.set('browse', safeBrowse)
  if (runId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) query.set('recommendation_run', runId)
  return `/jobs/${encodeURIComponent(jobId)}${query.size ? `?${query}` : ''}`
}
