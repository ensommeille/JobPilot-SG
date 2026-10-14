import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import ApplicationPreparation from '../components/ApplicationPreparation'
import { internsgApplicationUrl } from '../services/internsg'
import { fetchJobById } from '../services/jobs'
import { getToken, watchSession } from '../services/auth'

export default function ExternalApplicationPage() {
  const { id = '' } = useParams()
  const token = useSyncExternalStore(watchSession, getToken)
  const [accountChanged, setAccountChanged] = useState(false)
  useEffect(() => watchSession(() => setAccountChanged(true)), [])
  return <SessionApplicationPage key={JSON.stringify([id, token])} id={id} token={token} accountChanged={accountChanged} />
}

function SessionApplicationPage({ id, token, accountChanged }: { id: string; token: string | null; accountChanged: boolean }) {
  const [job, setJob] = useState<{ id: string; title: string; company: string; apply_url: string; status: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const request = new AbortController()
    fetchJobById(id, {signal: request.signal, timeout: 15000, headers: {Authorization: token ? `Bearer ${token}` : ''}})
      .then(response => {
        if (!request.signal.aborted && getToken() === token) setJob({...response.data, id})
      }).catch(() => {
        if (!request.signal.aborted && getToken() === token) setError('Could not load this job. Return to the job listing and try again.')
      })
    return () => request.abort()
  }, [id, token])
  const url = internsgApplicationUrl(job?.apply_url)
  return <div className="page external-application-page">
    <Navbar backTo={`/jobs/${id}`} backLabel="Back to job" />
    <main className="container stack">
      <header className="page-header"><h1>Prepare your application</h1><p>{job ? `${job.title} · ${job.company}` : 'Review saved details, then fill the original form.'}</p></header>
      {accountChanged && <p role="alert">Account changed. The embedded form has been closed and the previous draft cleared. Review this account's details before loading a fresh form. Answers already filled on another page are not undone.</p>}
      {error ? <p role="alert" className="alert alert-error">{error}</p> : !job ? <p role="status">Loading job details…</p>
        : job.status !== 'active' ? <p role="alert">This job is not active. Check the original listing before applying.</p>
          : !url ? <p role="alert">This job does not provide a supported InternSG application URL. Return to the listing and follow its application instructions. We do not guess an application URL.</p>
            : !token ? <p role="alert"><Link to={`/?next=${encodeURIComponent(`/jobs/${id}/apply-external`)}`}>Sign in to JobPilot</Link> to prepare your saved application details. No external form has been loaded.</p>
              : <ApplicationPreparation jobId={id} url={url} token={token} />}
    </main>
  </div>
}
