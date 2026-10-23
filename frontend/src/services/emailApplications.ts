import axios from 'axios'

export interface EmailOption {
  available: boolean
  mode: 'disabled' | 'test_smtp'
  original_recipient?: string
  actual_recipient?: string | null
  source_url?: string
  evidence?: string
  verified_at?: string
  notice?: string
  existing_application_id?: string | null
}

export interface EmailDraft {
  id: string
  job_id: string
  job_title?: string
  company?: string
  status: 'draft' | 'sending' | 'sent' | 'failed' | 'unknown'
  subject: string
  body: string
  reply_to: string
  original_recipient: string
  actual_recipient: string | null
  mode: 'disabled' | 'test_smtp'
  attachment: { filename: string; size_bytes: number; sha256: string } | null
  created_at: string
  sent_at: string | null
  failure_code?: string | null
  receipt?: { message_id?: string; [key: string]: unknown } | null
}

export interface EmailPreview {
  application: EmailDraft
  content_hash: string
  review_token: string
  expires_at: string | number
}

export interface PdfAttachment { filename: string; content_base64: string }

export function emailError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail: unknown = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (error.response?.status === 422) return 'Check the subject, message and complete PDF attachment (up to 2 MiB), then review again.'
  }
  return 'The request could not be completed. Reload the saved email before trying another action.'
}

export const emailStatus = (status: EmailDraft['status']) => ({
  draft: 'Draft saved', sending: 'Send status pending — check saved record',
  sent: 'Test email sent', failed: 'Email was not sent', unknown: 'Delivery uncertain — do not resend',
})[status]
