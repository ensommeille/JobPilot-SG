export interface ResponsibilityMatch {
  responsibility: string
  job_evidence: string
  priority: 'primary' | 'secondary' | 'conditional' | 'unspecified'
  condition: {value: string; evidence: string} | null
  outcome: 'related_evidence' | 'unknown'
  reason: string
  activities: string[]
  profile_evidence: string[]
}

const reasonText: Record<string, string> = {
  source_unverified: 'The source evidence for this duty could not be verified.',
  source_context_uncertain: 'The source wording is negative, uncertain or describes learning rather than assigned work.',
  scope_unverified: 'The source includes conditions or secondary duties that need review.',
  unsupported_activity: 'This activity is outside the current comparison rules.',
  no_related_project_evidence: 'No comparable saved project evidence was found. This is not an experience gap.',
  related_activity: 'The activities are related. This does not confirm the full responsibility or your proficiency.',
  related_conditional_activity: 'The activities are related, but the duty condition still needs review.',
}

function EvidencePair({item}: {item: ResponsibilityMatch}) {
  return <li className="responsibility-evidence-item responsibility-match">
    <p><strong>{item.responsibility}</strong></p>
    {item.condition && <p className="responsibility-evidence-note">Applies when: {item.condition.value}. This condition still needs review.</p>}
    {item.priority === 'conditional' && !item.condition && <p className="responsibility-evidence-note">Conditional responsibility — review when it applies. Not used for ranking.</p>}
    {item.priority === 'secondary' && <p className="responsibility-evidence-note">Secondary responsibility — kept for context, not ranking.</p>}
    <dl className="responsibility-evidence-pair">
      <dt>Job description</dt><dd>{item.job_evidence}
        {item.condition && item.condition.evidence !== item.job_evidence && <p>{item.condition.evidence}</p>}
      </dd>
      <dt>Your project experience</dt><dd>
        {item.profile_evidence.map((excerpt, index) => <p key={index}>{excerpt}</p>)}
      </dd>
    </dl>
  </li>
}

export default function ResponsibilityEvidence({items, showUnknown = true, showRelated = true}: {
  items?: ResponsibilityMatch[]
  showUnknown?: boolean
  showRelated?: boolean
}) {
  if (!items?.length) return null
  const related = items.filter(item => item.outcome === 'related_evidence')
  const unknown = items.filter(item => item.outcome === 'unknown')
  return <div className="responsibility-evidence responsibility-matches">
    {showRelated && <section aria-label="Related project experience">
      <h4>Related project experience</h4>
      {related.length ? <>
        <p className="responsibility-evidence-note">Similar activities in your saved experience. This does not confirm the full responsibility or your proficiency.</p>
        <ul className="responsibility-evidence-list">{related.map((item, index) => <EvidencePair key={index} item={item} />)}</ul>
      </> : <p className="responsibility-evidence-note">No clear project evidence found for these duties. This is not an experience gap.</p>}
    </section>}
    {showUnknown && unknown.length > 0 && <details className="responsibility-evidence-unknown responsibility-unknown">
      <summary>Other responsibilities to review ({unknown.length})</summary>
      <p className="responsibility-evidence-note">No reliable activity overlap was identified. Check the duties against your experience yourself.</p>
      <ul className="responsibility-evidence-list">{unknown.map((item, index) => <li className="responsibility-evidence-item" key={index}>
        <p><strong>{item.responsibility}</strong></p>
        {item.condition && <p className="responsibility-evidence-note">Applies when: {item.condition.value}</p>}
        {item.priority === 'conditional' && !item.condition && <p className="responsibility-evidence-note">Conditional responsibility — review when it applies.</p>}
        <details><summary>View source and reason</summary>
          <blockquote>{item.job_evidence}</blockquote>
          <p>{reasonText[item.reason] || 'No reliable activity comparison is available. Review the original duty.'}</p>
        </details>
      </li>)}</ul>
    </details>}
  </div>
}
