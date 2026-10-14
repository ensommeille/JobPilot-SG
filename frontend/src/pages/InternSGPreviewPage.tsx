import Navbar from '../components/Navbar'
import InternSGApplication from '../components/InternSGApplication'

// Development-only route; no job or application record is created.
export default function InternSGPreviewPage() {
  return <div className="page external-application-page"><Navbar backTo="/jobs" backLabel="Back to jobs" />
    <main className="container stack">
      <header className="page-header"><h1>InternSG embedded-form preview</h1><p>Development verification only — this is a real external form, not a sandbox employer.</p></header>
      <p className="external-warning">Do not submit fictional data. This preview does not add a job or application to the database. Verify filling and CAPTCHA display only.</p>
      <InternSGApplication url="https://www.internsg.com/job-apply/271036/" />
    </main>
  </div>
}
