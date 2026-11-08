import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchSessionByToken } from '../services/api';
import type {
  SessionMetadata,
  AgentState,
  ChatMessage,
} from '../types';
import { useMediaStream } from '../hooks/useMediaStream';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useInterviewWebSocket } from '../hooks/useInterviewWebSocket';
import { AIAvatar } from '../components/AIAvatar';
import { CandidateWebcam } from '../components/CandidateWebcam';
import { ChatTranscript } from '../components/ChatTranscript';
import { SilenceIndicator } from '../components/SilenceIndicator';
import { TextFallbackModal } from '../components/TextFallbackModal';
import {
  Mic,
  MicOff,
  CheckCircle2,
  Clock,
  ArrowRight,
  Wifi,
  WifiOff,
  AlertCircle,
  Keyboard,
  Sparkles,
  Award,
  RefreshCw,
} from 'lucide-react';

export const InterviewRoom: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  // Session state
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [candidateName, setCandidateName] = useState<string>('');
  const [candidateEmail, setCandidateEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Agent & Interview State
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [questionIndex, setQuestionIndex] = useState(1);
  const [totalQuestions, setTotalQuestions] = useState(8);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [silenceSeconds, setSilenceSeconds] = useState(0);
  const [thresholdSeconds, setThresholdSeconds] = useState(2.75);

  // Modals and UI state
  const [isTextFallbackOpen, setIsTextFallbackOpen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [closingMessage, setClosingMessage] = useState<string>('');

  // Media & Hardware
  const {
    stream,
    status: mediaStatus,
    isMuted,
    isVideoOff,
    audioLevel,
    requestPermissions,
    toggleMute,
    toggleVideo,
    stopAllTracks,
  } = useMediaStream(true);

  // Audio Playback Hook (AC-009, AC-010)
  const {
    isPlaying: isAudioPlaying,
    queueAudio,
    stopAudio,
  } = useAudioPlayer({
    onPlaybackStarted: () => {
      setAgentState('speaking');
    },
    onPlaybackEnded: () => {
      setAgentState((current) => (current === 'completed' ? 'completed' : 'listening'));
    },
  });

  // WebSocket Full-Duplex Hook (AC-008 to AC-014, AC-022, AC-026)
  const {
    isConnected,
    isConnecting,
    connectionError,
    sendAudioChunk,
    sendTranscriptUpdate,
    sendDoneAnswering,
    sendTextFallback,
    sendMuteToggle,
    reconnect,
  } = useInterviewWebSocket({
    token,
    candidateName,
    candidateEmail,
    enabled: !loading && !isCompleted && Boolean(token),
    onStatus: (msg) => {
      if (!isAudioPlaying) {
        setAgentState(msg.state);
      }
      if (msg.question_index) setQuestionIndex(msg.question_index);
      if (msg.total_questions) setTotalQuestions(msg.total_questions);
      if (msg.time_elapsed_seconds !== undefined) {
        setElapsedSeconds(msg.time_elapsed_seconds);
      }
      if (msg.state !== 'listening') {
        setSilenceSeconds(0);
      }
    },
    onQuestion: (msg) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `q-${msg.turn_index}-${Date.now()}`,
          turn_index: msg.turn_index,
          speaker: 'interviewer',
          text: msg.text,
          topic: msg.topic,
          timestamp: new Date().toISOString(),
        },
      ]);
      if (msg.turn_index) setQuestionIndex(msg.turn_index);
      setInterimTranscript('');
      setSilenceSeconds(0);
    },
    onAudio: (msg) => {
      if (msg.data) {
        queueAudio(msg.data, msg.format || 'audio/mp3');
      }
    },
    onTranscript: (msg) => {
      if (msg.is_final) {
        setMessages((prev) => {
          if (prev.some((m) => m.speaker === 'candidate' && m.text === msg.text)) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `ans-${Date.now()}`,
              turn_index: questionIndex,
              speaker: 'candidate',
              text: msg.text,
              timestamp: new Date().toISOString(),
              is_final: true,
            },
          ];
        });
        setInterimTranscript('');
        setSilenceSeconds(0);
      } else {
        setInterimTranscript(msg.text);
      }
    },
    onSilenceTick: (msg) => {
      setSilenceSeconds(msg.silence_seconds);
      setThresholdSeconds(msg.threshold_seconds);
    },
    onInterviewComplete: (msg) => {
      setIsCompleted(true);
      setClosingMessage(
        msg.closing_message ||
          'Thank you for completing your screening interview! Your responses have been submitted to the recruitment team.'
      );
      setAgentState('completed');
      stopAudio();
      stopAllTracks();
    },
  });

  // Live Browser Speech-to-Text Recognition (for instant visual feedback & zero latency)
  const recognitionRef = React.useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    if (isConnected && !isMuted && agentState === 'listening') {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              const trimmed = transcript.trim();
              if (trimmed) {
                sendTranscriptUpdate(trimmed, true);
                setMessages((prev) => {
                  if (prev.some((m) => m.speaker === 'candidate' && m.text === trimmed)) {
                    return prev;
                  }
                  return [
                    ...prev,
                    {
                      id: `ans-${Date.now()}-${Math.random()}`,
                      turn_index: questionIndex,
                      speaker: 'candidate',
                      text: trimmed,
                      timestamp: new Date().toISOString(),
                      is_final: true,
                    },
                  ];
                });
              }
            } else {
              interim += transcript;
            }
          }
          if (interim) {
            setInterimTranscript(interim);
            sendTranscriptUpdate(interim, false);
          }
        };

        recognition.onerror = (e: any) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.debug('Speech recognition note:', e.error);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.debug('Speech recognition init note:', err);
      }
    } else {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, [isConnected, isMuted, agentState, questionIndex, sendTranscriptUpdate]);

  // Audio Chunk Streaming via MediaRecorder Hook (AC-011, AC-014)
  useAudioRecorder({
    stream,
    isEnabled: isConnected && !isMuted && agentState === 'listening',
    timeslice: 250,
    onAudioChunk: (chunk) => {
      sendAudioChunk(chunk.data, chunk.format);
    },
    onError: (err) => {
      console.warn('Audio recorder error:', err);
    },
  });

  // Load session metadata and verified candidate info
  useEffect(() => {
    if (!token) return;

    const storedName = sessionStorage.getItem(`interview_${token}_name`) || '';
    const storedEmail = sessionStorage.getItem(`interview_${token}_email`) || '';

    fetchSessionByToken(token)
      .then((data) => {
        setSession(data);
        setCandidateName(storedName || data.candidate_name || 'Candidate');
        setCandidateEmail(storedEmail || data.candidate_email || '');
        setTotalQuestions(data.question_count || 8);
        if (data.status === 'completed') {
          setIsCompleted(true);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load session:', err);
        setLoading(false);
      });
  }, [token]);

  // Elapsed timer tick
  useEffect(() => {
    if (isCompleted || loading) return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, loading]);

  // Handle Mute Toggle (AC-014)
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    toggleMute();
    sendMuteToggle(nextMuted);
  };

  // Handle Manual "Done Answering" action (AC-013)
  const handleDoneAnswering = () => {
    if (interimTranscript && interimTranscript.trim()) {
      sendTranscriptUpdate(interimTranscript.trim(), true);
    }
    sendDoneAnswering();
    setInterimTranscript('');
    setSilenceSeconds(0);
    setAgentState('thinking');
  };

  // Handle Text Fallback submission (AC-026)
  const handleTextFallbackSubmit = (text: string) => {
    sendTextFallback(text);
    setMessages((prev) => [
      ...prev,
      {
        id: `fb-${Date.now()}`,
        turn_index: questionIndex,
        speaker: 'candidate',
        text: `[Typed]: ${text}`,
        timestamp: new Date().toISOString(),
        is_final: true,
      },
    ]);
    setInterimTranscript('');
    setSilenceSeconds(0);
    setAgentState('thinking');
  };

  // Format MM:SS helper
  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Completion Screen (AC-022)
  if (isCompleted) {
    const targetSessionId = session?.id || token;
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100">
        <div className="max-w-xl w-full rounded-3xl bg-slate-900 border border-slate-800 p-8 sm:p-10 shadow-2xl text-center space-y-6 animate-fade-in">
          <div className="w-20 h-20 rounded-3xl bg-emerald-950/80 border border-emerald-700/80 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-950/50">
            <Award className="w-10 h-10 animate-bounce" />
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-full bg-emerald-950 border border-emerald-800 text-xs font-semibold text-emerald-300">
              Session Completed
            </span>
            <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight">
              Thank You, {candidateName}!
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
              {closingMessage ||
                'Your automated interview answers have been recorded, evaluated, and securely delivered to the recruitment team.'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 text-left space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Position</span>
              <span className="font-semibold text-slate-200">{session?.job_title || 'Technical Role'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Total Duration</span>
              <span className="font-semibold font-mono text-slate-200">{formatSeconds(elapsedSeconds)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Status</span>
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Evaluated & Logged
              </span>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => navigate(`/results/${targetSessionId}`)}
              className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-950 transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <span>View Results</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header Bar */}
      <header className="h-16 px-4 sm:px-6 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="font-bold text-sm sm:text-base text-slate-100 truncate max-w-[200px] sm:max-w-xs">
              {session?.job_title || 'Technical Screening'}
            </h1>
          </div>

          {/* Connection status indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs">
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Live</span>
              </>
            ) : isConnecting ? (
              <>
                <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                <span className="text-amber-400 font-medium">Connecting...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-rose-400 animate-pulse" />
                <span className="text-rose-400 font-medium">Reconnecting...</span>
              </>
            )}
          </div>
        </div>

        {/* Center Progress & Timer Header (AC-008) */}
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Question <strong className="text-slate-200">{questionIndex}</strong> of {totalQuestions}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>{formatSeconds(elapsedSeconds)}</span>
            <span className="text-slate-600">/ {session?.duration_minutes || 30}:00</span>
          </div>
        </div>

        {/* Top-Right AI Interviewer Avatar Thumbnail (AC-009) */}
        <div className="flex items-center">
          <AIAvatar state={agentState} compact />
        </div>
      </header>

      {/* Connection Interruption Alert Toast (AC-026) */}
      {connectionError && (
        <div className="bg-rose-950/90 border-b border-rose-800 px-4 py-2.5 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2 animate-fade-in z-10">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{connectionError}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={reconnect}
              className="inline-flex items-center gap-1 underline font-semibold hover:text-white"
            >
              <RefreshCw className="w-3 h-3" /> Retry Connection
            </button>
            <button
              type="button"
              onClick={() => setIsTextFallbackOpen(true)}
              className="underline text-indigo-300 font-semibold hover:text-white"
            >
              Use Text Fallback
            </button>
          </div>
        </div>
      )}

      {/* Hardware Permission Warning Banner */}
      {(mediaStatus === 'denied' || mediaStatus === 'error') && (
        <div className="bg-amber-950/90 border-b border-amber-800 px-4 py-2 text-xs text-amber-200 flex items-center justify-between animate-fade-in z-10">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Hardware access error: Camera or microphone is unavailable.</span>
          </div>
          <button
            type="button"
            onClick={() => requestPermissions()}
            className="underline font-semibold hover:text-white"
          >
            Retry Device Access
          </button>
        </div>
      )}

      {/* Main Split-Screen Workspace (AC-008) */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 max-w-[1600px] w-full mx-auto overflow-hidden">
        {/* Left Column: Live Candidate Webcam Preview (AC-008) */}
        <section className="lg:col-span-5 xl:col-span-5 flex flex-col h-full min-h-[380px] lg:min-h-0">
          <CandidateWebcam
            stream={stream}
            candidateName={candidateName}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            audioLevel={audioLevel}
            onToggleMute={handleToggleMute}
            onToggleVideo={toggleVideo}
            showControls={true}
          />
        </section>

        {/* Right Column: Chat History, AI Avatar Focus, Action Controls (AC-008) */}
        <section className="lg:col-span-7 xl:col-span-7 flex flex-col h-full min-h-[460px] lg:min-h-0 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-hidden shadow-2xl">
          {/* Chat Transcript Area */}
          <ChatTranscript
            messages={messages}
            interimTranscript={interimTranscript}
            isListening={agentState === 'listening'}
          />

          {/* Silence Indicator Banner (AC-012) */}
          <div className="px-4 pb-2">
            <SilenceIndicator
              silenceSeconds={silenceSeconds}
              thresholdSeconds={thresholdSeconds}
            />
          </div>

          {/* Bottom Action Controls Bar (AC-012, AC-013, AC-014, AC-026) */}
          <footer className="p-4 bg-slate-950/90 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {/* Microphone Mute Toggle (AC-014) */}
              <button
                type="button"
                onClick={handleToggleMute}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-medium text-xs transition-colors border ${
                  isMuted
                    ? 'bg-rose-950/80 border-rose-800 text-rose-300 hover:bg-rose-900'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </button>

              {/* Text Fallback Button (AC-026) */}
              <button
                type="button"
                onClick={() => setIsTextFallbackOpen(true)}
                title="Type answer instead of speaking"
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium transition-colors"
              >
                <Keyboard className="w-4 h-4 text-indigo-400" />
                <span className="hidden sm:inline">Text Fallback</span>
              </button>
            </div>

            {/* Done Answering / Next Question Action (AC-013) */}
            <button
              type="button"
              disabled={agentState === 'speaking' || agentState === 'thinking' || isCompleted}
              onClick={handleDoneAnswering}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white shadow-lg shadow-emerald-950 transition-all active:scale-95"
            >
              <span>Done Answering / Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </footer>
        </section>
      </main>

      {/* Text Fallback Modal */}
      <TextFallbackModal
        isOpen={isTextFallbackOpen}
        onClose={() => setIsTextFallbackOpen(false)}
        onSubmit={handleTextFallbackSubmit}
      />
    </div>
  );
};
