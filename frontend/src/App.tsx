import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PreflightCheck } from './pages/PreflightCheck';
import { InterviewRoom } from './pages/InterviewRoom';
import { Dashboard } from './pages/Dashboard';
import { CreateSession } from './pages/CreateSession';
import { ScorecardResults } from './pages/ScorecardResults';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Recruiter Routes */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/recruiter" element={<Dashboard />} />
        <Route path="/create" element={<CreateSession />} />
        <Route path="/results/:sessionId" element={<ScorecardResults />} />

        {/* Candidate Workflow Routes */}
        <Route path="/interview/:token" element={<PreflightCheck />} />
        <Route path="/interview/:token/room" element={<InterviewRoom />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
