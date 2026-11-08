import React from 'react';
import { Clock } from 'lucide-react';

interface SilenceIndicatorProps {
  silenceSeconds: number;
  thresholdSeconds: number;
}

export const SilenceIndicator: React.FC<SilenceIndicatorProps> = ({
  silenceSeconds,
  thresholdSeconds,
}) => {
  if (silenceSeconds <= 0.3) return null;

  const remaining = Math.max(0, thresholdSeconds - silenceSeconds);
  const percentage = Math.min(100, Math.round((silenceSeconds / thresholdSeconds) * 100));

  return (
    <div className="w-full flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs shadow-md animate-fade-in">
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
        <span>
          Pause detected - finalizing answer in{' '}
          <span className="font-semibold font-mono text-amber-300">{remaining.toFixed(1)}s</span>
        </span>
      </div>

      <div className="w-24 h-1.5 rounded-full bg-amber-950 border border-amber-800/80 overflow-hidden">
        <div
          className="h-full bg-amber-400 transition-all duration-150 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
