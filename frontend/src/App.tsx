import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import JobListPage from './pages/JobListPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/jobs" element={<JobListPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App