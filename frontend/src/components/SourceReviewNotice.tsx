import './SourceReviewNotice.css'

export interface SourceReview {
  kind: 'agent_source_review'
  original_result_id: string
  input_hash: string
  corrected_sha256: string
  requires_human_review: true
  notice: string
}

export default function SourceReviewNotice({ review, count = 0 }: { review?: SourceReview | null; count?: number }) {
  if (!review && count < 1) return null
  return <aside className="source-review-notice" aria-label="Requirements source">
    <strong>Locally corrected draft</strong>
    <p>{review ? 'This comparison uses corrections checked against the job description.' : `${count} evaluated ${count === 1 ? 'job uses' : 'jobs use'} corrections checked against the job description.`} Final human review is pending. Verify the original posting before relying on these results.</p>
  </aside>
}
