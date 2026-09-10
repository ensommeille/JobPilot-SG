import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'

import JobListPage from './pages/JobListPage'
import JobDetailPage from './pages/JobDetailPage'
import ProfilePage from './pages/ProfilePage'
import FavoritesPage from './pages/FavoritesPage'
import ApplicationFormPage from './pages/ApplicationFormPage'
import ApplicationHistoryPage from './pages/ApplicationHistoryPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        
        <Route path="/jobs" element={<JobListPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/jobs/:id/apply" element={<ApplicationFormPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/applications" element={<ApplicationHistoryPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
