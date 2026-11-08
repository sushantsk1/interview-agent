import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, User, Maximize2, Minimize2 } from 'lucide-react';
import { AudioMeter } from './AudioMeter';

interface CandidateWebcamProps {
  stream: MediaStream | null;
  candidateName: string;
  isMuted: boolean;
  isVideoOff: boolean;
  audioLevel?: number;
  onToggleMute?: () => void;
  onToggleVideo?: () => void;
  showControls?: boolean;
}

export const CandidateWebcam: React.FC<CandidateWebcamProps> = ({
  stream,
  candidateName,
  isMuted,
  isVideoOff,
  audioLevel = 0,
  onToggleMute,
  onToggleVideo,
  showControls = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFitMode, setIsFitMode] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      if (stream && !isVideoOff) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, isVideoOff]);

  return (
    <div className="relative w-full h-full min-h-[300px] flex flex-col rounded-2xl bg-slate-900/90 border border-slate-800 overflow-hidden shadow-2xl">
      {/* Video Container */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden">
        {stream && !isVideoOff ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted // ALWAYS mute client preview to prevent local acoustic feedback
            className={`max-h-full max-w-full ${
              isFitMode ? 'object-contain' : 'w-full h-full object-cover'
            } transform -scale-x-100 transition-all duration-200`} // Mirror webcam for natural feeling
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-slate-500 p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
              <User className="w-10 h-10" />
            </div>
            <div>
              <p className="font-medium text-slate-300">{candidateName || 'Candidate'}</p>
              <p className="text-xs text-slate-500 mt-1">
                {isVideoOff ? 'Camera is currently turned off' : 'Waiting for video stream...'}
              </p>
            </div>
          </div>
        )}

        {/* Live indicator & Camera status badge (Top-Left) */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/60 text-xs font-medium text-slate-200">
            <span
              className={`w-2 h-2 rounded-full ${
                stream && !isVideoOff ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span>{stream && !isVideoOff ? 'Live Preview' : 'Camera Off'}</span>
          </div>

          {isMuted && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 backdrop-blur-md border border-rose-800 text-xs font-medium text-rose-300">
              <MicOff className="w-3 h-3 text-rose-400" />
              <span>Muted</span>
            </div>
          )}
        </div>

        {/* Candidate Name Badge (Bottom-Left) */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-100 text-sm font-medium shadow-md">
          <div className="w-2 h-2 rounded-full bg-indigo-400" />
          <span>{candidateName || 'Candidate'} (You)</span>
        </div>

        {/* Media Controls Bar (Bottom-Right overlay if enabled) */}
        {showControls && (
          <div className="absolute bottom-4 right-4 flex items-center gap-2">
            {onToggleMute && (
              <button
                type="button"
                onClick={onToggleMute}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                className={`p-2.5 rounded-full backdrop-blur-md transition-all ${
                  isMuted
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950'
                    : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}

            {onToggleVideo && (
              <button
                type="button"
                onClick={onToggleVideo}
                title={isVideoOff ? 'Enable camera' : 'Turn off camera'}
                className={`p-2.5 rounded-full backdrop-blur-md transition-all ${
                  isVideoOff
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950'
                    : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isVideoOff ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsFitMode((prev) => !prev)}
              title={isFitMode ? 'Zoom to Fill window' : 'Fit entire camera view (Unzoomed)'}
              className="p-2.5 rounded-full backdrop-blur-md transition-all bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              {isFitMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      {/* Embedded Live Audio Level Meter footer */}
      <div className="px-4 py-2.5 bg-slate-950/70 border-t border-slate-800/80">
        <AudioMeter
          level={audioLevel}
          isMuted={isMuted}
          label="Your Voice Activity"
          showIcon={false}
        />
      </div>
    </div>
  );
};
