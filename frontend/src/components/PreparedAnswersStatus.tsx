import { Link } from 'react-router-dom'
import type { ApplicationPreparationState } from '../hooks/usePreparedAnswers'
import './PreparedAnswersStatus.css'

export default function PreparedAnswersStatus({ state, profileLink }: { state: ApplicationPreparationState; profileLink: string }) {
  if (state.phase === 'idle') return null
  const count = state.report?.answers.filter(answer => answer.source !== 'pending_confirmation').length ?? 0
  return <p className="prepared-answers-status muted" role="status" aria-live="polite">
    {state.phase === 'pdf_mismatch' ? <>{state.resumeName ? `This attachment differs from the PDF used for autofill (${state.resumeName}).` : 'No matching PDF is selected for autofill.'} Saved Profile details remain available. <Link to={profileLink}>Choose the same PDF in Profile</Link> to prepare its drafts.</>
      : state.phase === 'pdf_selection' ? <>Choose a PDF in <Link to={profileLink}>Profile</Link> to prepare its drafts. Saved details are still available.</>
        : state.phase === 'preparing' ? 'Checking saved application details. AI prepares answers when you open JobPilot on the actual form.'
          : state.phase === 'waiting' ? 'An existing preparation is still running. Your saved details remain available.'
          : state.phase === 'unavailable' ? 'Saved details remain available. Open JobPilot on the application form to prepare answers from your PDF.'
            : count === 0 ? 'Saved details are ready. Open JobPilot on the application form to prepare answers from your PDF.'
            : `${state.report?.execution_mode === 'mock' ? 'Mock preview · ' : ''}${count} saved application ${count === 1 ? 'answer' : 'answers'} ready. Open JobPilot on the actual form to prepare its remaining answers.`}
  </p>
}
