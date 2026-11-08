import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Award,
  ArrowLeft,
  Printer,
  Clock,
  User,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  MessageSquare,
  FileText,
  RefreshCw,
  Bot,
  UserCheck,
  Zap,
} from 'lucide-react';
import { fetchScorecard, fetchTranscript } from '../services/api';
import type { ScorecardResponse, TranscriptResponse } from '../types';

export const ScorecardResults: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();

  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'deepdive' | 'transcript'>('deepdive');
  const [expandedTurns, setExpandedTurns] = useState<Record<number, boolean>>({});

  const loadData = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch both scorecard and transcript in parallel
      const [scData, trData] = await Promise.all([
        fetchScorecard(sessionId),
        fetchTranscript(sessionId).catch(() => null),
      ]);
      setScorecard(scData);
      setTranscript(trData);

      // Expand all turns by default
      if (scData?.evaluations) {
        const initialExpand: Record<number, boolean> = {};
        scData.evaluations.forEach((e) => {
          initialExpand[e.turn_index] = true;
        });
        setExpandedTurns(initialExpand);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load scorecard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      if (!sessionId) return;
      try {
        const [scData, trData] = await Promise.all([
          fetchScorecard(sessionId),
          fetchTranscript(sessionId).catch(() => null),
        ]);
        if (!ignore) {
          setScorecard(scData);
          setTranscript(trData);
          if (scData?.evaluations) {
            const initialExpand: Record<number, boolean> = {};
            scData.evaluations.forEach((e) => {
              initialExpand[e.turn_index] = true;
            });
            setExpandedTurns(initialExpand);
          }
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const msg = err instanceof Error ? err.message : 'Failed to load scorecard';
          setError(msg);
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, [sessionId]);

  const toggleTurn = (turnIndex: number) => {
    setExpandedTurns((prev) => ({
      ...prev,
      [turnIndex]: !prev[turnIndex],
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDuration = (seconds?: number): string => {
    if (seconds === undefined || seconds === null) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  const getRecommendationStyle = (rec?: string) => {
    const lower = (rec || '').toLowerCase();
    if (lower.includes('strong hire')) {
      return {
        bg: 'bg-emerald-950/80',
        text: 'text-emerald-400',
        border: 'border-emerald-800',
        badge: 'bg-emerald-500',
      };
    }
    if (lower.includes('hire')) {
      return {
        bg: 'bg-teal-950/80',
        text: 'text-teal-400',
        border: 'border-teal-800',
        badge: 'bg-teal-500',
      };
    }
    if (lower.includes('borderline')) {
      return {
        bg: 'bg-amber-950/80',
        text: 'text-amber-400',
        border: 'border-amber-800',
        badge: 'bg-amber-500',
      };
    }
    return {
      bg: 'bg-rose-950/80',
      text: 'text-rose-400',
      border: 'border-rose-800',
      badge: 'bg-rose-500',
    };
  };

  const getBenchmarkLabel = (score: number) => {
    if (score >= 9.0) return 'Exemplary';
    if (score >= 7.5) return 'Proficient';
    if (score >= 6.0) return 'Acceptable';
    return 'Needs Work';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col print:bg-white print:text-black">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium border border-slate-700/60 transition-colors shadow-sm"
              title="Print or export scorecard"
            >
              <Printer className="w-3.5 h-3.5 text-indigo-400" />
              <span>Print / Export PDF</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        {loading ? (
          <div className="space-y-6">
            <div className="h-32 rounded-3xl bg-slate-900/60 border border-slate-800 animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse" />
              ))}
            </div>
          </div>
        ) : error || !scorecard ? (
          /* Error or Not Ready State */
          <div className="max-w-lg mx-auto rounded-3xl bg-slate-900 border border-slate-800 p-8 text-center space-y-5 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-amber-950/80 border border-amber-800 text-amber-400 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-100">Scorecard Not Available</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {error ||
                  'The candidate may not have completed this interview session yet, or scoring is still in progress.'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={loadData}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
              <Link
                to="/"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Return to Dashboard
              </Link>
            </div>
          </div>
        ) : (
          /* Completed Scorecard Presentation */
          <div className="space-y-8">
            {/* Header Profile Hero */}
            <div className="relative overflow-hidden rounded-3xl bg-slate-900/80 border border-slate-800 p-6 sm:p-8 shadow-xl">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                {/* Candidate & Job Profile */}
                <div className="space-y-3 flex-1">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-800 text-xs font-semibold text-indigo-300">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Candidate Evaluation Scorecard</span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 tracking-tight">
                    {scorecard.candidate_name || 'Anonymous Candidate'}
                  </h1>

                  <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs text-slate-400">
                    <span className="font-semibold text-slate-300 text-sm">{scorecard.job_title}</span>
                    <span className="text-slate-600">•</span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Duration: {formatDuration(scorecard.duration_seconds)}</span>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{scorecard.evaluations?.length || 0} Questions Evaluated</span>
                    </span>
                  </div>
                </div>

                {/* Overall Score & Recommendation Hero Badge */}
                <div className="flex items-center gap-6 p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-slate-800 shrink-0 shadow-inner">
                  {/* Score Pill / Circle */}
                  <div className="text-center space-y-1">
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Overall Rating</p>
                    <div className="flex items-baseline justify-center">
                      <span className="text-3xl sm:text-4xl font-black text-indigo-400" data-testid="overall-score">
                        {scorecard.overall_score?.toFixed(1) ?? 'N/A'}
                      </span>
                      <span className="text-xs font-semibold text-slate-500 ml-1">/ 10</span>
                    </div>
                  </div>

                  <div className="h-10 w-[1px] bg-slate-800" />

                  {/* Recommendation Badge */}
                  <div className="space-y-1.5 text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Recommendation</p>
                    <div>
                      {(() => {
                        const style = getRecommendationStyle(scorecard.recommendation);
                        return (
                          <span
                            data-testid="recommendation-badge"
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-bold border ${style.bg} ${style.text} ${style.border}`}
                          >
                            <Award className="w-3.5 h-3.5" />
                            {scorecard.recommendation}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4-Dimension Score Grid (AC-020, AC-024) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="dimensions-grid">
              {[
                {
                  key: 'relevance',
                  label: 'Relevance',
                  score: scorecard.dimension_scores?.relevance ?? 0,
                  desc: 'Directness & alignment with prompt',
                  color: 'bg-indigo-500',
                  track: 'bg-indigo-950/40',
                },
                {
                  key: 'depth',
                  label: 'Technical Depth',
                  score: scorecard.dimension_scores?.depth ?? 0,
                  desc: 'Substantive detail & nuance',
                  color: 'bg-sky-500',
                  track: 'bg-sky-950/40',
                },
                {
                  key: 'correctness',
                  label: 'Correctness',
                  score: scorecard.dimension_scores?.correctness ?? 0,
                  desc: 'Conceptual & technical accuracy',
                  color: 'bg-emerald-500',
                  track: 'bg-emerald-950/40',
                },
                {
                  key: 'communication',
                  label: 'Communication',
                  score: scorecard.dimension_scores?.communication ?? 0,
                  desc: 'Structure, clarity & conciseness',
                  color: 'bg-amber-500',
                  track: 'bg-amber-950/40',
                },
              ].map((dim) => {
                const percentage = Math.min(100, Math.max(0, dim.score * 10));
                return (
                  <div
                    key={dim.key}
                    data-testid={`dimension-${dim.key}`}
                    className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{dim.label}</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">
                        {getBenchmarkLabel(dim.score)}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black text-slate-100">{dim.score.toFixed(1)}</span>
                      <span className="text-xs text-slate-500">/ 10</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${dim.color} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>

                    <p className="text-[11px] text-slate-500">{dim.desc}</p>
                  </div>
                );
              })}
            </div>

            {/* AI Executive Summary & Strengths/Growth Areas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Executive Summary (2 Cols) */}
              <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Zap className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    Executive Summary
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed" data-testid="executive-summary">
                  {scorecard.summary || 'No summary available.'}
                </p>
              </div>

              {/* Strengths & Growth Areas (1 Col) */}
              <div className="space-y-6">
                {/* Strengths */}
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Key Strengths</h3>
                  </div>
                  {scorecard.strengths && scorecard.strengths.length > 0 ? (
                    <ul className="space-y-2 text-xs text-slate-300" data-testid="strengths-list">
                      {scorecard.strengths.map((str, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-emerald-400 font-bold">•</span>
                          <span>{str}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No specific strengths recorded.</p>
                  )}
                </div>

                {/* Areas for Improvement */}
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Areas for Improvement
                    </h3>
                  </div>
                  {scorecard.growth_areas && scorecard.growth_areas.length > 0 ? (
                    <ul className="space-y-2 text-xs text-slate-300" data-testid="growth-areas-list">
                      {scorecard.growth_areas.map((ga, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-amber-400 font-bold">•</span>
                          <span>{ga}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No specific growth areas recorded.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation Tabs: Question Deep Dive vs Full Transcript */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <button
                  onClick={() => setActiveTab('deepdive')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                    activeTab === 'deepdive'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-900/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Award className="w-4 h-4" />
                  <span>Question-by-Question Deep Dive</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-300">
                    {scorecard.evaluations?.length || 0}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('transcript')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                    activeTab === 'transcript'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-900/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Verbatim Chronological Transcript</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-300">
                    {transcript?.turns?.length || 0} turns
                  </span>
                </button>
              </div>

              {/* Tab 1: Deep Dive Evaluations */}
              {activeTab === 'deepdive' && (
                <div className="space-y-4" data-testid="deepdive-section">
                  {scorecard.evaluations && scorecard.evaluations.length > 0 ? (
                    scorecard.evaluations.map((item) => {
                      const isExpanded = expandedTurns[item.turn_index] ?? true;

                      return (
                        <div
                          key={item.turn_index}
                          data-testid={`deepdive-card-${item.turn_index}`}
                          className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-md"
                        >
                          {/* Card Header / Accordion Trigger */}
                          <div
                            onClick={() => toggleTurn(item.turn_index)}
                            role="button"
                            tabIndex={0}
                            className="p-5 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-850/50 transition-colors"
                          >
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="px-2.5 py-0.5 rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-bold">
                                Turn {item.turn_index}
                              </span>
                              {item.topic && (
                                <span className="px-2.5 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700">
                                  {item.topic}
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                                  item.is_follow_up
                                    ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {item.is_follow_up ? 'Follow-Up Question' : 'Primary Question'}
                              </span>
                            </div>

                            <span className="text-xs text-slate-400">
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </span>
                          </div>

                          {/* Collapsible Content */}
                          {isExpanded && (
                            <div className="px-5 pb-5 pt-0 space-y-4 border-t border-slate-800/60">
                              {/* AI Question */}
                              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-3 mt-4">
                                <div className="w-8 h-8 rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-400 flex items-center justify-center shrink-0">
                                  <Bot className="w-4 h-4" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[10px] uppercase font-bold text-slate-400">Interviewer Question</p>
                                  <p className="text-xs sm:text-sm font-medium text-slate-200">{item.question}</p>
                                </div>
                              </div>

                              {/* Candidate Answer */}
                              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center shrink-0">
                                  <User className="w-4 h-4" />
                                </div>
                                <div className="space-y-1 flex-1">
                                  <p className="text-[10px] uppercase font-bold text-slate-400">Candidate Response</p>
                                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
                                    {item.answer || <span className="italic text-slate-500">No response recorded</span>}
                                  </p>
                                </div>
                              </div>

                              {/* 4-Dimension Scores for This Turn */}
                              {item.scores && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                      Relevance
                                    </span>
                                    <span className="text-sm font-bold text-indigo-400">
                                      {item.scores.relevance.toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Depth</span>
                                    <span className="text-sm font-bold text-sky-400">
                                      {item.scores.depth.toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                      Correctness
                                    </span>
                                    <span className="text-sm font-bold text-emerald-400">
                                      {item.scores.correctness.toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                                      Communication
                                    </span>
                                    <span className="text-sm font-bold text-amber-400">
                                      {item.scores.communication.toFixed(1)}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* AI Evaluator Feedback */}
                              {item.feedback && (
                                <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-900/60 text-xs space-y-1">
                                  <p className="font-semibold text-indigo-300 text-[11px] uppercase tracking-wider">
                                    AI Evaluator Justification
                                  </p>
                                  <p className="text-slate-300 leading-relaxed">{item.feedback}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      No turn evaluations available for this session.
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Verbatim Transcript (AC-029) */}
              {activeTab === 'transcript' && (
                <div className="space-y-4" data-testid="transcript-section">
                  {transcript && transcript.turns && transcript.turns.length > 0 ? (
                    <div className="space-y-3">
                      {transcript.turns.map((t, idx) => {
                        const isInterviewer = t.speaker === 'interviewer';
                        return (
                          <div
                            key={idx}
                            className={`p-4 rounded-2xl border flex items-start gap-3.5 ${
                              isInterviewer
                                ? 'bg-indigo-950/20 border-indigo-900/50'
                                : 'bg-slate-900 border-slate-800'
                            }`}
                          >
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                isInterviewer
                                  ? 'bg-indigo-950 text-indigo-400 border border-indigo-800'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {isInterviewer ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                            </div>

                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between">
                                <span
                                  className={`text-xs font-bold ${
                                    isInterviewer ? 'text-indigo-400' : 'text-slate-200'
                                  }`}
                                >
                                  {isInterviewer ? 'AI Interviewer' : 'Candidate'}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500">
                                  {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : ''}
                                </span>
                              </div>
                              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">{t.text}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-8 text-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 text-xs">
                      No verbatim transcript records found for this session.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
