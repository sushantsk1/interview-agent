import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, PlusCircle, Users, BarChart3, ArrowRight } from 'lucide-react';

export const DashboardPlaceholder: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 sm:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800 text-xs font-semibold text-indigo-300">
              <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
              <span>Recruiter Portal</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
              Interview Dashboard
            </h1>
            <p className="text-sm text-slate-400">
              Manage automated AI screening sessions and review evaluated scorecards.
            </p>
          </div>

          <Link
            to="/create"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-950 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create New Interview</span>
          </Link>
        </header>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-800 text-indigo-400 flex items-center justify-center">
              <PlusCircle className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-100 text-base">Quick Session Setup</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Paste job descriptions and upload candidate resumes to automatically configure customized voice interviews.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-100 text-base">Conversational Voice Screening</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Real-time Deepgram speech synthesis and speech-to-text with LangGraph-orchestrated adaptive questioning.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-950 border border-amber-800 text-amber-400 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-100 text-base">Objective 4D Scorecards</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automated evaluation of candidate answers across Relevance, Depth, Correctness, and Communication.
            </p>
          </div>
        </div>

        {/* Candidate Experience Testing Callout */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-semibold text-slate-100 text-sm">Testing Candidate Flow?</h4>
            <p className="text-xs text-slate-400 mt-1">
              Access candidate device pre-flight check and live room by visiting{' '}
              <code className="text-indigo-300 font-mono">/interview/:token</code>.
            </p>
          </div>
          <Link
            to="/interview/demo-sample-token"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors shrink-0"
          >
            <span>Test Pre-Flight UI</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
