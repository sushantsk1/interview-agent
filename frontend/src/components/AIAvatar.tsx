import React from 'react';
import type { AgentState } from '../types';
import { Volume2, Ear, Sparkles, Circle, CheckCircle2 } from 'lucide-react';

interface AIAvatarProps {
  state: AgentState;
  compact?: boolean;
}

export const AIAvatar: React.FC<AIAvatarProps> = ({ state, compact = false }) => {
  const getBadgeConfig = () => {
    switch (state) {
      case 'speaking':
        return {
          label: 'Speaking',
          color: 'text-sky-400 bg-sky-950/80 border-sky-800',
          dot: 'bg-sky-400 animate-ping',
          icon: <Volume2 className="w-3.5 h-3.5 text-sky-400 animate-pulse" />,
        };
      case 'listening':
        return {
          label: 'Listening',
          color: 'text-emerald-400 bg-emerald-950/80 border-emerald-800',
          dot: 'bg-emerald-400 animate-ping',
          icon: <Ear className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case 'thinking':
        return {
          label: 'Thinking...',
          color: 'text-amber-300 bg-amber-950/80 border-amber-800',
          dot: 'bg-amber-400 animate-pulse',
          icon: <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin" style={{ animationDuration: '3s' }} />,
        };
      case 'completed':
        return {
          label: 'Finished',
          color: 'text-purple-400 bg-purple-950/80 border-purple-800',
          dot: 'bg-purple-400',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />,
        };
      case 'idle':
      default:
        return {
          label: 'Standby',
          color: 'text-slate-400 bg-slate-900/80 border-slate-700',
          dot: 'bg-slate-500',
          icon: <Circle className="w-3 h-3 text-slate-500 fill-slate-500" />,
        };
    }
  };

  const badge = getBadgeConfig();

  return (
    <div className={`relative flex items-center ${compact ? 'gap-2.5' : 'flex-col gap-3'} select-none`}>
      {/* Avatar Container with State Rings */}
      <div className="relative flex items-center justify-center">
        {/* Speaking concentric sound ripples */}
        {state === 'speaking' && (
          <>
            <span className="absolute inline-flex h-full w-full rounded-full bg-sky-500 opacity-30 animate-ping" />
            <span className="absolute -inset-2 rounded-full border-2 border-sky-400/40 animate-pulse" />
            <span className="absolute -inset-4 rounded-full border border-sky-400/20" />
          </>
        )}

        {/* Listening microphone glow */}
        {state === 'listening' && (
          <>
            <span className="absolute -inset-1.5 rounded-full bg-emerald-500/20 blur-sm animate-pulse" />
            <span className="absolute -inset-1 rounded-full border-2 border-emerald-500/50" />
          </>
        )}

        {/* Thinking gentle pulse */}
        {state === 'thinking' && (
          <>
            <span className="absolute -inset-1.5 rounded-full bg-amber-500/20 blur-sm animate-pulse" />
            <span className="absolute -inset-1 rounded-full border-2 border-dashed border-amber-400/50 animate-spin" style={{ animationDuration: '6s' }} />
          </>
        )}

        {/* Core Avatar Face */}
        <div
          className={`relative z-10 ${
            compact ? 'w-10 h-10' : 'w-16 h-16'
          } rounded-2xl bg-gradient-to-tr from-indigo-950 via-slate-900 to-indigo-900 border border-indigo-700/60 shadow-lg flex items-center justify-center overflow-hidden transition-all duration-300`}
        >
          {/* Stylized AI Wave / Hologram Graphic */}
          <div className="flex items-center justify-center gap-0.5">
            <span
              className={`w-1 rounded-full bg-indigo-400 transition-all duration-200 ${
                state === 'speaking'
                  ? 'h-6 bg-sky-400 animate-pulse'
                  : state === 'listening'
                  ? 'h-4 bg-emerald-400'
                  : 'h-2 bg-indigo-400'
              }`}
            />
            <span
              className={`w-1 rounded-full bg-indigo-300 transition-all duration-200 ${
                state === 'speaking'
                  ? 'h-9 bg-sky-300 animate-pulse'
                  : state === 'listening'
                  ? 'h-6 bg-emerald-300'
                  : 'h-4 bg-indigo-300'
              }`}
              style={{ animationDelay: '100ms' }}
            />
            <span
              className={`w-1 rounded-full bg-indigo-400 transition-all duration-200 ${
                state === 'speaking'
                  ? 'h-5 bg-sky-400 animate-pulse'
                  : state === 'listening'
                  ? 'h-3 bg-emerald-400'
                  : 'h-2 bg-indigo-400'
              }`}
              style={{ animationDelay: '200ms' }}
            />
          </div>
        </div>
      </div>

      {/* Dynamic Status Badge */}
      <div className="flex flex-col items-center">
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border shadow-sm backdrop-blur-md transition-colors ${badge.color}`}
        >
          {badge.icon}
          <span>{badge.label}</span>
        </div>
      </div>
    </div>
  );
};
