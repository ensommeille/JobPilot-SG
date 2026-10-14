export const applicationFields = [
  { id: 'applicant_name', label: 'Full name', maxLength: 200 },
  { id: 'applicant_email', label: 'Contact email', maxLength: 320 },
  { id: 'applicant_contact', label: 'Phone', maxLength: 40 },
  { id: 'applicant_period', label: 'Availability period', maxLength: 500 },
  { id: 'applicant_summary', label: 'Personal introduction', maxLength: 3000 },
] as const
export type ApplicationFieldId = typeof applicationFields[number]['id']
export type ApplicationValues = Record<ApplicationFieldId, string>
export interface CountryChoices { nationality: string; campus: string }
export interface SavedApplicationDraft { values: ApplicationValues; countries: CountryChoices }
export interface InspectedField { id: ApplicationFieldId; maxLength: number; occupied: boolean; unavailable?: boolean }
export interface ApplicationReview {
  review_id: string; expires_at: number; fields: InspectedField[]
  countries: {code: string; name: string}[]; countries_available: boolean; country_reason?: string
}
export interface FillReport { filled: string[]; skipped: string[]; reasons: Record<string, string> }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const fieldIds = applicationFields.map(field => field.id) as string[]
const allIds = [...fieldIds, 'applicant_countries']

export function parseSavedDraft(value: unknown): SavedApplicationDraft {
  if (!record(value) || value.profile_source !== 'jobpilot' || value.summary_status !== 'manual_only'
      || value.requires_review !== true || value.submission_supported !== false || !record(value.values) || !record(value.countries)) {
    throw new Error('The profile service is not compatible. Update the backend before preparing an application.')
  }
  const values = {} as ApplicationValues
  for (const field of applicationFields) {
    const text = value.values[field.id] ?? ''
    if (typeof text !== 'string' || text.length > field.maxLength) throw new Error('Saved application details are invalid. Review your profile before continuing.')
    values[field.id] = text
  }
  const countries: CountryChoices = { nationality: '', campus: '' }
  for (const key of ['nationality', 'campus'] as const) {
    const code = value.countries[key] ?? ''
    if (typeof code !== 'string' || (code !== '' && !/^[a-z]{2}$/.test(code))) throw new Error('Saved countries are invalid. Review your profile before continuing.')
    countries[key] = code
  }
  return { values, countries }
}
export async function draftFingerprint(draft: SavedApplicationDraft): Promise<string> {
  const canonical = {values: Object.fromEntries(applicationFields.map(field => [field.id, draft.values[field.id] || ''])),
    countries: {nationality: draft.countries.nationality || '', campus: draft.countries.campus || ''}}
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function parseApplicationReview(value: Record<string, unknown>): ApplicationReview {
  const invalid = () => new Error('The extension response is incompatible. Reload the updated JobPilot extension and check this form again.')
  if (value.version !== 1 || typeof value.review_id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.review_id)
      || typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at) || value.expires_at <= Date.now()
      || value.expires_at > Date.now() + 10 * 60_000 || !Array.isArray(value.fields) || value.fields.length > 5
      || !Array.isArray(value.countries) || value.countries.length > 300 || typeof value.countries_available !== 'boolean') throw invalid()
  const seen = new Set<string>()
  const fields = value.fields.map(field => {
    if (!record(field) || typeof field.id !== 'string' || !fieldIds.includes(field.id) || seen.has(field.id)) throw invalid()
    const definition = applicationFields.find(item => item.id === field.id)!
    if (typeof field.occupied !== 'boolean' || !Number.isInteger(field.maxLength) || Number(field.maxLength) < 1
        || Number(field.maxLength) > definition.maxLength || (field.unavailable !== undefined && typeof field.unavailable !== 'boolean')) throw invalid()
    seen.add(field.id)
    return {id: field.id as ApplicationFieldId, occupied: field.occupied, maxLength: Number(field.maxLength), unavailable: field.unavailable === true}
  })
  const codes = new Set<string>()
  const countries = value.countries.map(country => {
    if (!record(country) || typeof country.code !== 'string' || !/^[a-z]{2}$/.test(country.code) || codes.has(country.code)
        || typeof country.name !== 'string' || !country.name || country.name.length > 200) throw invalid()
    codes.add(country.code)
    return {code: country.code, name: country.name}
  })
  return {review_id: value.review_id, expires_at: value.expires_at, fields, countries,
    countries_available: value.countries_available,
    country_reason: typeof value.country_reason === 'string' ? value.country_reason.slice(0, 1000) : undefined}
}
export function parseFillReport(value: Record<string, unknown>, approvedIds: string[]): FillReport {
  if (value.submitted !== false || !Array.isArray(value.filled) || !Array.isArray(value.skipped) || !record(value.reasons)) {
    throw new Error('Fill result could not be verified. Check the original form before checking it again; nothing will be retried automatically.')
  }
  const combined: unknown[] = [...value.filled, ...value.skipped]
  if (combined.length !== approvedIds.length || new Set(combined).size !== combined.length
      || combined.some(id => typeof id !== 'string' || !allIds.includes(id) || !approvedIds.includes(id))) {
    throw new Error('Fill result could not be verified. Inspect the original form; do not assume every answer was filled.')
  }
  const reasons: Record<string, string> = {}
  for (const id of value.skipped as string[]) reasons[id] = typeof value.reasons[id] === 'string'
    ? value.reasons[id].slice(0, 1000) : 'The field changed or could not be safely filled. Check it on the original form.'
  return {filled: value.filled as string[], skipped: value.skipped as string[], reasons}
}
