import React from 'react';
import { Mic, MicOff } from 'lucide-react';

interface AudioMeterProps {
  level: number; // 0 to 100
  isMuted?: boolean;
  label?: string;
  showIcon?: boolean;
}

export const AudioMeter: React.FC<AudioMeterProps> = ({
  level,
  isMuted = false,
  label = 'Microphone Level',
  showIcon = true,
}) => {
  // Quantize into 12 distinct level bars for responsive aesthetic display
  const totalBars = 14;
  const activeBars = isMuted ? 0 : Math.round((level / 100) * totalBars);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1.5 font-medium">
          {showIcon && (
            isMuted ? (
              <MicOff className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Mic className="w-3.5 h-3.5 text-emerald-400" />
            )
          )}
          {label}
        </span>
        <span className="text-[11px] font-mono">
          {isMuted ? 'Muted' : `${level}%`}
        </span>
      </div>

      <div
        className="flex items-center gap-1 h-3 p-1 rounded-md bg-slate-900 border border-slate-800"
        role="meter"
        aria-label={label}
        aria-valuenow={isMuted ? 0 : level}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.from({ length: totalBars }).map((_, idx) => {
          const isActive = idx < activeBars;
          let barColor = 'bg-emerald-500';
          if (idx >= 11) {
            barColor = 'bg-rose-500';
          } else if (idx >= 8) {
            barColor = 'bg-amber-400';
          }

          return (
            <div
              key={idx}
              className={`flex-1 h-full rounded-sm transition-all duration-75 ${
                isActive ? barColor : 'bg-slate-800 opacity-40'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
};
