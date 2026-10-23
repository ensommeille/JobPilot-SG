import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

import JobListPage from './pages/JobListPage'
import JobDetailPage from './pages/JobDetailPage'
import ProfilePage from './pages/ProfilePage'
import ConnectExtensionPage from './pages/ConnectExtensionPage'
import FavoritesPage from './pages/FavoritesPage'
import ApplicationFormPage from './pages/ApplicationFormPage'
import ApplicationHistoryPage from './pages/ApplicationHistoryPage'
import ExternalApplicationPage from './pages/ExternalApplicationPage'
import InternSGPreviewPage from './pages/InternSGPreviewPage'
import PrepareApplicationPage from './pages/PrepareApplicationPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/jobs/:id/prepare" element={<PrepareApplicationPage />} />
        <Route path="/jobs/:id/apply" element={<ApplicationFormPage />} />
        <Route path="/jobs/:id/apply-external" element={<ExternalApplicationPage />} />
        {import.meta.env.DEV && <Route path="/jobs/internsg-preview/apply-external" element={<InternSGPreviewPage />} />}
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/connect-extension" element={<ConnectExtensionPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/applications" element={<ApplicationHistoryPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
