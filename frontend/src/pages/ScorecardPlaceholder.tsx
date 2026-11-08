import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Award, ArrowLeft, Clock } from 'lucide-react';

export const ScorecardPlaceholder: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 sm:p-10 flex flex-col items-center justify-center">
      <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-slate-800 p-8 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-950/80 border border-amber-800 text-amber-400 mx-auto flex items-center justify-center">
          <Award className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Task T-008 Scheduled</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Candidate Scorecard</h1>
          <p className="text-xs text-slate-400 font-mono">Session ID: {sessionId || 'N/A'}</p>
          <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
            The full recruiter candidate scorecard view (4-dimension rating radar, timestamped transcript replay, strengths, and recommendations) is scheduled for implementation in Task T-008.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Dashboard</span>
        </Link>
      </div>
    </div>
  );
};
