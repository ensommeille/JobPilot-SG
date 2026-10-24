import type { AxiosRequestConfig } from 'axios'
import api from './api'

export const autofillFields = [
  ['given_name', 'First / given name'], ['family_name', 'Last / family name'], ['full_name', 'Full name'],
  ['contact_email', 'Contact email'], ['phone', 'Phone'], ['phone_country_code', 'Phone country code'],
  ['school', 'School'], ['degree', 'Degree'], ['discipline', 'Field of study'],
  ['education_start_year', 'Education start year'], ['education_start_month', 'Education start month'],
  ['education_end_year', 'Education end year'], ['education_end_month', 'Education end month'],
  ['current_city', 'Current city'], ['current_country', 'Current country'],
  ['nationality', 'Nationality'], ['study_country', 'Country of study'],
  ['internship_start_date', 'Internship start date'], ['internship_end_date', 'Internship end date'],
  ['availability_period', 'Availability'], ['work_arrangement', 'Work arrangement'],
  ['salary_expectation', 'Salary expectation'], ['notice_period', 'Notice period'],
  ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['portfolio', 'Portfolio'],
  ['skills', 'Skills'], ['experience', 'Experience'], ['education', 'Education summary'], ['resume_summary', 'Introduction'],
] as const
export type AutofillKey = typeof autofillFields[number][0]
export interface AutofillSource { source: 'profile' | 'manual' | 'resume'; quote: string | null; resume_id: string | null }
export interface AutofillResume { id: string; filename: string; sha256: string | null; has_file?: boolean; size_bytes?: number; uploaded_at?: string }
export interface AutofillProfile {
  values: Record<string, string>
  sources: Record<string, AutofillSource>
  missing_fields: string[]
  resume: AutofillResume | null
  resumes: AutofillResume[]
  requires_resume_selection: boolean
  extraction_status: 'ready' | 'not_extracted' | 'no_resume' | 'selection_required' | 'failed'
  fingerprint: string
  review?: { reviewed: true; reason: string } | null
}
export interface ResumeAutofillResult {
  resume_id: string; sha256: string; prompt_version: string; status: 'ready' | 'failed'; reused: boolean
  facts: Record<string, { value: string; quote: string }>; error_code: string | null
}
export interface PdfActionGate { busy: boolean; acquire: () => number | null; release: (lease: number) => void }
export const fetchAutofillProfile = (config?: AxiosRequestConfig) => api.get<AutofillProfile>('/browser-assistant/autofill-profile', config)
export const updateAutofillDetails = (data: { resume_id?: string | null; values?: Record<string, string | null> }, config?: AxiosRequestConfig) =>
  api.patch<AutofillProfile>('/profile/autofill-details', data, config)
export const readResumeForAutofill = (id: string, config?: AxiosRequestConfig) =>
  api.post<ResumeAutofillResult>(`/profile/resumes/${id}/autofill`, { confirmed: true }, { ...config, timeout: 90000 })
