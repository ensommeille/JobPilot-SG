import { useId } from 'react'
import { Link } from 'react-router-dom'
import './HowToUseGuide.css'

export default function HowToUseGuide({ id, onClose }: { id: string; onClose: () => void }) {
  const titleId = useId()

  return <section id={id} className="usage-guide" aria-labelledby={titleId} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }}>
    <div className="usage-guide-inner">
      <div className="usage-guide-heading">
        <h2 id={titleId}>How to use JobPilot</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close guide</button>
      </div>
      <ol className="usage-guide-steps">
        <li>
          <h3>Save your PDF and profile</h3>
          <p>Upload your resume PDF in <Link to="/profile?returnTo=%2Fjobs">Profile</Link>. Review the extracted details and save any corrections.</p>
        </li>
        <li>
          <h3>Find a role</h3>
          <p>Choose <strong>Recommend to me</strong> on Jobs. <strong>Show all jobs</strong> returns to the full list.</p>
        </li>
        <li>
          <h3>Prepare your application</h3>
          <p>Open a job and choose <strong>Prepare application</strong>. Review your saved details and selected PDF, then continue to its application form.</p>
        </li>
        <li>
          <h3>Fill, review and submit</h3>
          <p>On a supported original form, open the Chrome extension. It prepares answers automatically. Click <strong>Fill</strong>, then check the answers on the page.</p>
        </li>
      </ol>
      <div className="usage-guide-footer">
        <details className="usage-guide-connection">
          <summary>Connect the extension once</summary>
          <ol>
            <li>Open JobPilot in Chrome with the extension installed.</li>
            <li>Open the extension and choose <strong>Connect through JobPilot</strong>.</li>
            <li>Confirm the same account with <strong>Confirm and connect extension</strong>, then return to the application form.</li>
          </ol>
        </details>
        <p>Fill never submits. Attach your PDF, complete any remaining questions, and submit on the original website when you are ready.</p>
      </div>
    </div>
  </section>
}
