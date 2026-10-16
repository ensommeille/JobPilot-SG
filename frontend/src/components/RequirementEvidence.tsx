export interface ConditionEvidence {
  kind: string
  requirement: string
  qualifier: string | null
  qualifier_evidence?: string | null
  outcome: 'supported' | 'gap' | 'unknown'
  reason: string
  job_evidence: string
  profile_evidence: string | null
}

export interface StructuredRequirement {
  group_operator?: 'all_of' | 'any_of' | 'unspecified' | null
  conditions?: ConditionEvidence[]
}

export interface WorkConstraintEvidence {
  category: string
  requirement: string
  reason: string
  job_evidence: string
}

const operators = {
  all_of: 'All listed conditions are required together.',
  any_of: 'The source allows an alternative among these conditions.',
  unspecified: 'The relationship between these conditions needs review.',
}

export function RequirementConditions({item}: {item: StructuredRequirement}) {
  if (!item.conditions?.length) return null
  return <div>
    {item.group_operator && <p>{operators[item.group_operator]}</p>}
    <ul aria-label="Individual requirement conditions">
      {item.conditions.map((condition, index) => <li key={index}>
        <p><strong>{condition.requirement}</strong> ({condition.kind})
          {' — '}{condition.outcome === 'supported' ? 'Skill entry shared' : condition.outcome === 'gap' ? 'Explicit gap' : 'Unknown'}</p>
        {condition.qualifier && <p>Source condition: {condition.qualifier}</p>}
        <p>{condition.reason}</p>
        <details><summary>Condition evidence</summary>
          <dl><dt>Job description</dt><dd>{condition.job_evidence}</dd>
            {condition.qualifier_evidence && <><dt>Qualifier quote</dt><dd>{condition.qualifier_evidence}</dd></>}
            <dt>Your profile</dt><dd>{condition.profile_evidence || 'No comparable explicit evidence used.'}</dd></dl>
        </details>
      </li>)}
    </ul>
  </div>
}

export function WorkConstraints({items = []}: {items?: WorkConstraintEvidence[]}) {
  return <div className="job-work-constraints">
    <h4>Work conditions: compatibility unknown</h4>
    <p>Saved skills do not establish your availability, location or preferred work arrangements.</p>
    {items.length ? <ul>{items.map((item, index) => <li key={index}>
      <p><strong>{item.requirement}</strong> — Unknown</p>
      <p>{item.reason}</p>
      {item.job_evidence && <details><summary>Work condition evidence</summary><blockquote>{item.job_evidence}</blockquote></details>}
    </li>)}</ul> : <p>Work conditions have not been checked. Review the original listing.</p>}
  </div>
}
