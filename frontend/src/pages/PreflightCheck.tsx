import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchSessionByToken, ApiError } from '../services/api';
import type { SessionMetadata } from '../types';
import { useMediaStream } from '../hooks/useMediaStream';
import { AudioMeter } from '../components/AudioMeter';
import {
  Video,
  Mic,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Briefcase,
  HelpCircle,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  CameraOff,
} from 'lucide-react';

export const PreflightCheck: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  // Session metadata state
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [sessionError, setSessionError] = useState<string | null>(
    token ? null : 'No interview session token provided in URL.'
  );

  // Candidate input state
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  // Hardware check hook
  const {
    stream,
    status: mediaStatus,
    errorMessage: mediaError,
    isMuted,
    audioLevel,
    requestPermissions,
    toggleMute,
  } = useMediaStream(false);

  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to preview video element
  useEffect(() => {
    if (previewVideoRef.current && stream) {
      previewVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Load session metadata on mount
  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    fetchSessionByToken(token)
      .then((data) => {
        if (!isMounted) return;
        setSession(data);
        if (data.candidate_name) {
          setCandidateName(data.candidate_name);
        }
        if (data.candidate_email) {
          setCandidateEmail(data.candidate_email);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setSessionError('This interview link is invalid or does not exist. Please contact your recruiter.');
          } else {
            setSessionError(err.message || 'Failed to load interview session details.');
          }
        } else {
          setSessionError('Unable to connect to the interview server. Please verify the backend is running.');
        }
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Validate candidate input
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isNameValid = candidateName.trim().length >= 2;
  const isEmailValid = emailRegex.test(candidateEmail.trim());
  const isFormValid = isNameValid && isEmailValid;

  const handleStartPermissions = async () => {
    setNameTouched(true);
    setEmailTouched(true);
    if (!isFormValid) return;
    await requestPermissions();
  };

  const handleEnterInterview = () => {
    if (!isFormValid || mediaStatus !== 'granted') return;
    // Persist verified name and email in sessionStorage for room access
    sessionStorage.setItem(`interview_${token}_name`, candidateName.trim());
    sessionStorage.setItem(`interview_${token}_email`, candidateEmail.trim());
    navigate(`/interview/${token}/room`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100">
        <div className="flex flex-col items-center gap-4 text-center">
          <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin" />
          <h2 className="text-xl font-medium text-slate-200">Loading Interview Session...</h2>
          <p className="text-sm text-slate-400">Verifying session credentials and instructions</p>
        </div>
      </div>
    );
  }

  // Error State: Invalid or Expired Token (AC-004)
  if (sessionError || !session) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-rose-900/50 p-8 shadow-2xl text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-rose-950/60 border border-rose-800 text-rose-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Invalid or Expired Link</h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              {sessionError || 'We could not locate this interview invitation.'}
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 text-left">
            <p className="font-semibold text-slate-300 mb-1">Troubleshooting Tips:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Ensure the full link URL was copied without missing characters.</li>
              <li>Check if the session was previously submitted or expired.</li>
              <li>Contact the hiring team to request a new invitation link.</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>
        </div>
      </div>
    );
  }

  // Completed State: Interview Already Taken (AC-004, AC-022)
  if (session.status === 'completed') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100">
        <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-emerald-900/50 p-8 shadow-2xl text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-950/60 border border-emerald-800 text-emerald-400 mx-auto flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Interview Completed</h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              This screening session for <strong className="text-slate-200">{session.job_title}</strong> has already been completed and submitted.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 text-left space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Applicant:</span>
              <span className="font-medium text-slate-300">{session.candidate_name || 'Candidate'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Questions Answered:</span>
              <span className="font-medium text-slate-300">{session.question_count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Submitted:</span>
              <span className="font-medium text-slate-300">
                {session.completed_at ? new Date(session.completed_at).toLocaleDateString() : 'Completed'}
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Your results and responses are securely shared with the recruitment team. No further action is required.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/70 border border-indigo-800 text-xs font-semibold text-indigo-300">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Automated Technical Screening</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-100">
            Device Pre-Flight & Onboarding
          </h1>
          <p className="text-base text-slate-400 max-w-xl mx-auto">
            Please verify your information and test your camera and microphone before beginning your interview.
          </p>
        </div>

        {/* Session Metadata Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 text-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800/80 text-indigo-400 border border-slate-700">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Position</p>
              <p className="font-semibold text-slate-100 truncate">{session.job_title}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800/80 text-emerald-400 border border-slate-700">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Duration Cap</p>
              <p className="font-semibold text-slate-100">{session.duration_minutes} minutes max</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-800/80 text-amber-400 border border-slate-700">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Structure</p>
              <p className="font-semibold text-slate-100">{session.question_count} questions ({session.difficulty})</p>
            </div>
          </div>
        </div>

        {/* Main Grid: Form + Hardware Pre-flight Check */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Left Column: Candidate Information Form (AC-005) */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-xl">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100">1. Candidate Information</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Confirm your name and email address for this session.
              </p>
            </div>

            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div>
                <label htmlFor="candidate-name" className="block text-xs font-semibold text-slate-300 mb-1">
                  Full Name <span className="text-rose-400">*</span>
                </label>
                <input
                  id="candidate-name"
                  type="text"
                  required
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  placeholder="e.g. Jane Doe"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                {nameTouched && !isNameValid && (
                  <p className="text-rose-400 text-xs mt-1">Please enter your full name (at least 2 characters).</p>
                )}
              </div>

              <div>
                <label htmlFor="candidate-email" className="block text-xs font-semibold text-slate-300 mb-1">
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <input
                  id="candidate-email"
                  type="email"
                  required
                  value={candidateEmail}
                  onChange={(e) => setCandidateEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="e.g. jane.doe@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                {emailTouched && !isEmailValid && (
                  <p className="text-rose-400 text-xs mt-1">Please enter a valid email address.</p>
                )}
              </div>

              {/* Hardware Permission Request CTA if not yet granted */}
              {mediaStatus === 'idle' && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={!isFormValid}
                    onClick={handleStartPermissions}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium text-sm shadow-md transition-colors"
                  >
                    <Video className="w-4 h-4" />
                    <span>Check Camera & Microphone</span>
                  </button>
                  {!isFormValid && (
                    <p className="text-[11px] text-slate-500 text-center mt-2">
                      Please enter your name and email to proceed to hardware verification.
                    </p>
                  )}
                </div>
              )}
            </form>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 space-y-2">
              <p className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Privacy & Data Notice:
              </p>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Your webcam feed is processed directly inside your browser for interview presence. In accordance with platform privacy specifications, video streams are not recorded or saved on the server. Only speech audio is transcribed.
              </p>
            </div>
          </div>

          {/* Right Column: Hardware Media Preview & Permissions (AC-006, AC-007) */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-xl">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">2. Hardware Pre-Flight Check</h2>
                <p className="text-xs text-slate-400 mt-0.5">Test your video feed and voice input.</p>
              </div>

              {mediaStatus === 'granted' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> Ready
                </span>
              )}
            </div>

            {/* Video Preview Box (AC-006) */}
            <div className="relative aspect-video w-full rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shadow-inner">
              {stream && mediaStatus === 'granted' ? (
                <video
                  ref={previewVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform -scale-x-100"
                />
              ) : mediaStatus === 'requesting' ? (
                <div className="flex flex-col items-center gap-3 text-center p-6">
                  <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
                  <p className="text-sm font-medium text-slate-300">Requesting device access...</p>
                  <p className="text-xs text-slate-500">Please click "Allow" in your browser prompt.</p>
                </div>
              ) : mediaStatus === 'denied' ? (
                <div className="flex flex-col items-center gap-2 text-center p-6 text-rose-400">
                  <CameraOff className="w-10 h-10 mb-1" />
                  <p className="text-sm font-semibold">Camera/Mic Access Denied</p>
                  <p className="text-xs text-rose-300/80 max-w-xs">
                    Please allow browser device access to continue.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center p-6 text-slate-500">
                  <Video className="w-10 h-10 mb-1 text-slate-600" />
                  <p className="text-sm font-medium text-slate-400">Webcam Preview</p>
                  <p className="text-xs text-slate-600 max-w-xs">
                    Click "Check Camera & Microphone" to test your devices.
                  </p>
                </div>
              )}
            </div>

            {/* Audio Level Meter (AC-006) */}
            {mediaStatus === 'granted' && (
              <div className="space-y-3 pt-1">
                <AudioMeter
                  level={audioLevel}
                  isMuted={isMuted}
                  label="Microphone Live Activity (Say something to test)"
                />
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white"
                  >
                    <Mic className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{isMuted ? 'Unmute microphone' : 'Mute microphone'}</span>
                  </button>
                  <span className="text-[11px] text-emerald-400">
                    {audioLevel > 15 ? '? Good voice volume detected' : 'Speak to verify volume'}
                  </span>
                </div>
              </div>
            )}

            {/* Explicit Permission Denial UI (AC-007) */}
            {(mediaStatus === 'denied' || mediaStatus === 'error') && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-200 space-y-3 animate-fade-in">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-rose-100">Hardware Access Needed</h4>
                    <p className="text-xs text-rose-300/90 mt-1 leading-relaxed">
                      {mediaError || 'Your browser blocked microphone and camera access.'}
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/80 border border-rose-900/60 text-slate-300 text-[11px] space-y-1.5">
                  <p className="font-semibold text-rose-200">How to re-enable permissions:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400">
                    <li>Click the lock or camera/tune icon in the browser address bar (left of URL).</li>
                    <li>Toggle Camera and Microphone permissions to "Allow".</li>
                    <li>Reload the page or click "Retry Permission Check" below.</li>
                  </ol>
                </div>

                <button
                  type="button"
                  onClick={requestPermissions}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-medium text-xs transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Permission Check</span>
                </button>
              </div>
            )}

            {/* Start Interview Action Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={!isFormValid || mediaStatus !== 'granted'}
                onClick={handleEnterInterview}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-base shadow-lg shadow-emerald-950 transition-all duration-200"
              >
                <span>Enter Live Interview Room</span>
                <ArrowRight className="w-5 h-5" />
              </button>
              {mediaStatus !== 'granted' && (
                <p className="text-[11px] text-slate-500 text-center mt-2">
                  Complete camera & mic check above to unlock the interview room.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
