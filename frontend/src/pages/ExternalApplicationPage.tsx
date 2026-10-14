import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import InternSGApplication from '../components/InternSGApplication'
import { internsgApplicationUrl } from '../services/internsg'
import { fetchJobById } from '../services/jobs'

export default function ExternalApplicationPage() {
  const { id } = useParams()
  const [job, setJob] = useState<{ id: string; title: string; company: string; apply_url: string; status: string } | null>(null)
  const [failure, setFailure] = useState<{id: string; message: string} | null>(null)
  const error = failure && failure.id === id ? failure.message : ''
  useEffect(() => {
    let active = true
    fetchJobById(String(id)).then(response => {
      if (active) { setJob({ ...response.data, id: String(id) }); setFailure(null) }
    }).catch(() => { if (active) setFailure({id: String(id), message: 'Could not load this job. Return to the job listing and try again.'}) })
    return () => { active = false }
  }, [id])
  const current = job?.id === id ? job : null
  const url = internsgApplicationUrl(current?.apply_url)
  return <div className="page external-application-page">
    <Navbar backTo={`/jobs/${id}`} backLabel="Back to job" />
    <main className="container stack">
      <header className="page-header"><h1>{current?.title || 'Apply through InternSG'}</h1><p>{current?.company || 'Embedded application pilot'}</p></header>
      {error ? <p role="alert" className="alert alert-error">{error}</p> : !current ? <p role="status">Loading job details…</p>
        : current.status !== 'active' ? <p role="alert">This job is not active. Check the original listing before applying.</p>
          : !url ? <p role="alert">This job does not provide a supported InternSG application URL. Return to the listing and follow its application instructions. We do not guess an application URL.</p>
            : <InternSGApplication key={`${id}:${url}`} url={url} />}
    </main>
  </div>
}
