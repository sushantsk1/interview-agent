import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import { Bot, User, Mic } from 'lucide-react';

interface ChatTranscriptProps {
  messages: ChatMessage[];
  interimTranscript?: string;
  isListening?: boolean;
  isThinking?: boolean;
}

export const ChatTranscript: React.FC<ChatTranscriptProps> = ({
  messages,
  interimTranscript = '',
  isListening = false,
  isThinking = false,
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollEndRef.current && typeof scrollEndRef.current.scrollIntoView === 'function') {
      scrollEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, interimTranscript, isThinking]);

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex-1 w-full overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && !interimTranscript && (
        <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center text-slate-500 py-12">
          <Bot className="w-10 h-10 mb-2 text-slate-600 animate-pulse" />
          <p className="text-sm font-medium text-slate-400">Interview will begin shortly</p>
          <p className="text-xs text-slate-600 mt-1 max-w-xs">
            Your conversational transcript with the AI interviewer will appear here in real-time.
          </p>
        </div>
      )}

      {messages.map((msg) => {
        const isAI = msg.speaker === 'interviewer';
        const isCandidate = msg.speaker === 'candidate';

        if (isAI) {
          return (
            <div key={msg.id} className="flex flex-col items-start max-w-[85%] sm:max-w-[78%]">
              {/* Header info */}
              <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                <div className="w-5 h-5 rounded-full bg-indigo-950 border border-indigo-700 flex items-center justify-center text-indigo-300">
                  <Bot className="w-3 h-3" />
                </div>
                <span className="font-semibold text-slate-300">AI Interviewer</span>
                {msg.topic && (
                  <span className="px-1.5 py-0.2 rounded bg-indigo-950/80 border border-indigo-800 text-indigo-300 text-[10px]">
                    {msg.topic}
                  </span>
                )}
                <span className="text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>
              </div>

              {/* Message Bubble */}
              <div className="p-3.5 rounded-2xl rounded-tl-sm bg-slate-900 border border-slate-800 text-slate-100 text-sm leading-relaxed shadow-sm">
                {msg.text}
              </div>
            </div>
          );
        }

        if (isCandidate) {
          return (
            <div key={msg.id} className="flex flex-col items-end ml-auto max-w-[85%] sm:max-w-[78%]">
              {/* Header info */}
              <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                <span className="text-slate-500 font-mono">{formatTime(msg.timestamp)}</span>
                <span className="font-semibold text-slate-300">You</span>
                <div className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-300">
                  <User className="w-3 h-3" />
                </div>
              </div>

              {/* Message Bubble */}
              <div className="p-3.5 rounded-2xl rounded-tr-sm bg-emerald-950/50 border border-emerald-800/80 text-emerald-50 text-sm leading-relaxed shadow-sm">
                {msg.text}
              </div>
            </div>
          );
        }

        // System messages
        return (
          <div key={msg.id} className="flex justify-center my-2">
            <span className="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 font-medium">
              {msg.text}
            </span>
          </div>
        );
      })}

      {/* Interim Candidate Speech Bubble (streaming real-time preview) */}
      {interimTranscript && (
        <div className="flex flex-col items-end ml-auto max-w-[85%] sm:max-w-[78%] animate-pulse">
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-emerald-400">
            <Mic className="w-3 h-3 animate-ping" />
            <span className="font-medium">Transcribing live...</span>
          </div>
          <div className="p-3.5 rounded-2xl rounded-tr-sm bg-emerald-950/30 border border-dashed border-emerald-600/80 text-emerald-200 text-sm italic leading-relaxed">
            {interimTranscript}
          </div>
        </div>
      )}

      {/* Listening indicator when candidate hasn't spoken yet */}
      {isListening && !interimTranscript && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/50 border border-slate-800/70 text-slate-400 text-xs w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span>Microphone active — speak your answer clearly...</span>
        </div>
      )}

      {/* Question Generation Loader - Neural Waveform & Thinking Orb (Option A) */}
      {isThinking && (
        <div data-testid="thinking-loader" className="flex flex-col items-start max-w-[88%] sm:max-w-[80%] animate-fade-in space-y-1">
          {/* Header */}
          <div className="flex items-center gap-2 mb-0.5 text-[11px] text-indigo-400">
            <div className="w-5 h-5 rounded-full bg-indigo-950 border border-indigo-700 flex items-center justify-center text-indigo-300">
              <Bot className="w-3 h-3 animate-pulse" />
            </div>
            <span className="font-semibold text-slate-300">AI Interviewer</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
              Thinking...
            </span>
          </div>

          {/* Loader Card */}
          <div className="p-3.5 rounded-2xl rounded-tl-sm bg-slate-900/95 border border-indigo-500/40 text-slate-100 shadow-lg shadow-indigo-950/30 w-full space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="relative flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 shadow-md shadow-indigo-500/25 shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Formulating next question...
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Evaluating response & synthesizing question
                  </div>
                </div>
              </div>

              {/* Animated Soundwave Equalizer */}
              <div className="flex items-center gap-1 h-6 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 shrink-0">
                <span className="w-1 bg-indigo-400 rounded-full wave-bar" />
                <span className="w-1 bg-violet-400 rounded-full wave-bar" />
                <span className="w-1 bg-pink-400 rounded-full wave-bar" />
                <span className="w-1 bg-indigo-400 rounded-full wave-bar" />
                <span className="w-1 bg-violet-400 rounded-full wave-bar" />
              </div>
            </div>

            {/* Shimmer skeleton lines previewing incoming question */}
            <div className="space-y-1.5 pt-0.5">
              <div className="h-2 rounded-full w-4/5 animate-shimmer" />
              <div className="h-2 rounded-full w-3/5 animate-shimmer" />
            </div>
          </div>
        </div>
      )}

      <div ref={scrollEndRef} />
    </div>
  );
};
