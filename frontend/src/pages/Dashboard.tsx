import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  PlusCircle,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Calendar,
  Award,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  Hourglass,
  Layers,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { fetchSessions } from '../services/api';
import type { SessionMetadata, InterviewStatus } from '../types';

type FilterTab = 'all' | 'pending' | 'in_progress' | 'completed';

export const Dashboard: React.FC = () => {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSessions();
      setSessions(res.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch sessions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const res = await fetchSessions();
        if (!ignore) {
          setSessions(res.items || []);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const msg = err instanceof Error ? err.message : 'Failed to fetch sessions';
          setError(msg);
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleCopyLink = async (token: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const candidateUrl = `${window.location.origin}/interview/${token}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(candidateUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = candidateUrl;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedToken(token);
      showToast('Candidate interview link copied to clipboard!');
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      showToast('Could not copy link to clipboard');
    }
  };

  const stats = useMemo(() => {
    return {
      total: sessions.length,
      pending: sessions.filter((s) => s.status === 'pending').length,
      inProgress: sessions.filter((s) => s.status === 'in_progress').length,
      completed: sessions.filter((s) => s.status === 'completed').length,
    };
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const matchesTab = activeTab === 'all' || s.status === activeTab;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.job_title.toLowerCase().includes(q) ||
        (s.candidate_name && s.candidate_name.toLowerCase().includes(q)) ||
        (s.candidate_email && s.candidate_email.toLowerCase().includes(q)) ||
        s.difficulty.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [sessions, activeTab, searchQuery]);

  const getStatusBadge = (status: InterviewStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-950/80 text-blue-400 border border-blue-800 animate-pulse">
            <Hourglass className="w-3.5 h-3.5" />
            In Progress
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-400 border border-amber-800">
            <Clock className="w-3.5 h-3.5" />
            Pending
          </span>
        );
    }
  };

  const getRecommendationBadge = (recommendation?: string | null) => {
    if (!recommendation) return null;
    const lower = recommendation.toLowerCase();
    let style = 'bg-slate-800 text-slate-300 border-slate-700';
    if (lower.includes('strong hire')) {
      style = 'bg-emerald-950/90 text-emerald-300 border-emerald-700';
    } else if (lower.includes('hire')) {
      style = 'bg-teal-950/90 text-teal-300 border-teal-700';
    } else if (lower.includes('borderline')) {
      style = 'bg-amber-950/90 text-amber-300 border-amber-700';
    } else if (lower.includes('not hire')) {
      style = 'bg-rose-950/90 text-rose-300 border-rose-700';
    }

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
        <Award className="w-3 h-3" />
        {recommendation}
      </span>
    );
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-indigo-500/50 text-slate-100 shadow-2xl"
        >
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-100">AI Interview Agent</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-400 border border-indigo-800">
                  Recruiter
                </span>
              </div>
              <p className="text-xs text-slate-400">Autonomous Technical Screening Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadSessions}
              disabled={loading}
              title="Refresh sessions list"
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 transition-colors disabled:opacity-50"
              aria-label="Refresh sessions"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <Link
              to="/create"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs sm:text-sm shadow-lg shadow-indigo-950 transition-all hover:shadow-indigo-900/40"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create New Interview</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        {/* Metric Cards Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-slate-800/80 text-slate-300 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Total Interviews</p>
              <p className="text-2xl font-bold text-slate-100">{stats.total}</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-amber-950/60 border border-amber-800/50 text-amber-400 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Pending</p>
              <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-blue-950/60 border border-blue-800/50 text-blue-400 flex items-center justify-center shrink-0">
              <Hourglass className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">In Progress</p>
              <p className="text-2xl font-bold text-blue-400">{stats.inProgress}</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Completed</p>
              <p className="text-2xl font-bold text-emerald-400">{stats.completed}</p>
            </div>
          </div>
        </div>

        {/* Filter Tabs & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 rounded-xl border border-slate-800 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All Sessions', count: stats.total },
                { id: 'pending', label: 'Pending', count: stats.pending },
                { id: 'in_progress', label: 'In Progress', count: stats.inProgress },
                { id: 'completed', label: 'Completed', count: stats.completed },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    activeTab === tab.id ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by role or candidate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="font-semibold text-rose-200">Unable to load interview sessions</p>
              <p className="mt-1 text-rose-300/80">{error}</p>
            </div>
            <button
              onClick={loadSessions}
              className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-100 rounded-lg text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Session List Table / Cards */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-slate-900/40 border border-slate-800/80 animate-pulse flex items-center px-6 gap-6"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-800 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-800 rounded w-1/3" />
                  <div className="h-3 bg-slate-800/60 rounded w-1/4" />
                </div>
                <div className="w-24 h-6 bg-slate-800 rounded-full" />
              </div>
            ))}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center space-y-4 max-w-lg mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-slate-800/60 text-slate-400 mx-auto flex items-center justify-center">
              <Briefcase className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-200">
                {sessions.length === 0 ? 'No Interview Sessions Yet' : 'No Matching Sessions'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                {sessions.length === 0
                  ? 'Set up your first automated interview screening by providing a job description and optional resume.'
                  : 'No interview sessions match the current filter and search query. Try clearing your search or switching tabs.'}
              </p>
            </div>
            {sessions.length === 0 ? (
              <Link
                to="/create"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-950 transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Create Your First Interview</span>
              </Link>
            ) : (
              <button
                onClick={() => {
                  setActiveTab('all');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                <span>Clear Filters</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4" data-testid="sessions-list">
            {filteredSessions.map((session) => {
              const isCompleted = session.status === 'completed';

              return (
                <div
                  key={session.id}
                  data-testid={`session-card-${session.id}`}
                  className="group relative rounded-2xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition-all p-5 sm:p-6 shadow-md hover:shadow-xl hover:shadow-slate-950/40"
                >
                  <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
                    {/* Left Column: Job & Candidate Info */}
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                          {session.job_title}
                        </h2>
                        {getStatusBadge(session.status)}
                        {isCompleted && session.recommendation && getRecommendationBadge(session.recommendation)}
                      </div>

                      {/* Candidate info or Unassigned */}
                      <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-400">
                        <span className="font-medium text-slate-300">
                          {session.candidate_name ? (
                            <span>{session.candidate_name}</span>
                          ) : (
                            <span className="text-slate-500 italic">Unassigned Candidate</span>
                          )}
                          {session.candidate_email && (
                            <span className="text-slate-500 ml-1.5">({session.candidate_email})</span>
                          )}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="flex items-center gap-1 text-slate-400">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          {formatDate(session.created_at)}
                        </span>
                      </div>

                      {/* Interview Specs Badges */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[11px] font-medium border border-slate-700/60">
                          {session.difficulty}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[11px] font-medium border border-slate-700/60">
                          {session.question_count} Questions
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[11px] font-medium border border-slate-700/60">
                          {session.duration_minutes} min cap
                        </span>
                        {session.has_resume && (
                          <span className="px-2.5 py-0.5 rounded-md bg-indigo-950/70 text-indigo-300 text-[11px] font-medium border border-indigo-800/60">
                            Resume Attached
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle Column: Score Rating Hero (if completed) */}
                    {isCompleted && session.overall_score !== null && session.overall_score !== undefined && (
                      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Overall Score</p>
                          <p className="text-lg font-extrabold text-slate-100">
                            <span className="text-indigo-400">{session.overall_score.toFixed(1)}</span>
                            <span className="text-xs text-slate-500 font-normal"> / 10</span>
                          </p>
                        </div>
                        <div className="w-9 h-9 rounded-lg bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                      </div>
                    )}

                    {/* Right Column: Interactive Actions */}
                    <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800/60">
                      {/* Copy Candidate Invite Link Button */}
                      <button
                        onClick={(e) => handleCopyLink(session.token, e)}
                        title="Copy candidate invite link"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 text-xs font-medium border border-slate-700/60 transition-colors"
                      >
                        {copiedToken === session.token ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>

                      {/* View Scorecard Button (always accessible for completed, or preview) */}
                      {isCompleted ? (
                        <Link
                          to={`/results/${session.id}`}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-950 transition-colors"
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>View Scorecard</span>
                          <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                        </Link>
                      ) : (
                        <Link
                          to={`/interview/${session.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                        >
                          <span>Candidate View</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};
