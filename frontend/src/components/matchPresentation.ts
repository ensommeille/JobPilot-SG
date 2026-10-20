import type { ConditionEvidence, StructuredRequirement } from './RequirementEvidence'

interface TraitCandidate extends StructuredRequirement {
  category: string
  requirement: string
  job_evidence: string
  outcome: 'supported' | 'gap' | 'unknown'
  skill_overlaps?: {kind: 'specific' | 'general'}[]
  conditions?: (ConditionEvidence & {skill_overlaps?: {kind: 'specific' | 'general'}[]})[]
}

// This is a presentation allowlist, not a second matching or ranking engine.
// Require the entire label AND source quote to be generic. Unknown wording stays
// prominent, including technical uses of "communication" and mixed requirements.
const modifiers = 'strong|good|excellent|effective|keen|solid|great|exceptional'
const traitNames = [
  'communication(?: skills)?',
  'team ?work', 'team player',
  'attention to detail', 'detail[ -]oriented',
  'interpersonal skills', 'time management(?: skills)?',
  'problem[ -]solving(?: skills)?',
  'organi[sz]ational (?:skills|ability)',
  'adaptability', 'leadership(?: skills)?', 'critical thinking(?: skills)?',
].join('|')
const phrase = `(?:(?:a|an)\\s+)?(?:(?:${modifiers})\\s+)?(?:${traitNames})`
const join = '(?:\\s*[,;]\\s*(?:(?:and|with)\\s+)?|\\s+(?:and|with|&)\\s+)'
const genericStatement = new RegExp(`^${phrase}(?:${join}${phrase})*(?:\\s+(?:(?:is|are)\\s+)?(?:required|preferred))?[.!]?$`, 'i')
const genericQualifier = new RegExp(`^(?:${modifiers})$`, 'i')

function isGenericStatement(value: string): boolean {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return normalized.length <= 2000 && genericStatement.test(normalized)
}

export function isGeneralTraitOnly(item: TraitCandidate): boolean {
  if (item.outcome !== 'unknown'
    || !['required_skills', 'preferred_skills', 'requirement_groups'].includes(item.category)
    || item.skill_overlaps?.some(skill => skill.kind === 'specific')) return false
  if (!isGenericStatement(item.requirement) || !isGenericStatement(item.job_evidence)) return false
  // Model-assigned kinds are not enough: a technical skill can be mislabelled.
  // Preserve languages, qualifications, interests and unfamiliar qualifiers.
  return !item.conditions?.length || item.conditions.every(condition =>
    ['trait', 'skill'].includes(condition.kind)
    && !condition.skill_overlaps?.some(skill => skill.kind === 'specific')
    && isGenericStatement(condition.requirement)
    && isGenericStatement(condition.job_evidence)
    && (!condition.qualifier || genericQualifier.test(condition.qualifier.trim()))
    && (!condition.qualifier_evidence || genericQualifier.test(condition.qualifier_evidence.trim())
      || isGenericStatement(condition.qualifier_evidence)))
}
