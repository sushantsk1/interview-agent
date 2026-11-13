import { useState, useEffect, useRef, useCallback } from 'react';

import { logDiagnostic } from '../services/diagnostics';

export type MediaPermissionStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

export interface UseMediaStreamReturn {
  stream: MediaStream | null;
  status: MediaPermissionStatus;
  errorMessage: string | null;
  isMuted: boolean;
  isVideoOff: boolean;
  audioLevel: number; // 0 - 100
  requestPermissions: () => Promise<boolean>;
  toggleMute: () => void;
  toggleVideo: () => void;
  stopAllTracks: () => void;
}

export function useMediaStream(autoStart = false): UseMediaStreamReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<MediaPermissionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Stop all media tracks and audio context
  const stopAllTracks = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
      setStream(null);
    }
    setAudioLevel(0);
  }, []);

  // Set up audio analyzer for live audio meter
  const setupAudioMeter = useCallback((mediaStream: MediaStream) => {
    try {
      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = source;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Scale to 0-100 percentage with gentle curve
        const normalized = Math.min(100, Math.round((average / 128) * 100));

        setAudioLevel(normalized);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
          animFrameRef.current = requestAnimationFrame(updateMeter);
        }).catch(() => {
          animFrameRef.current = requestAnimationFrame(updateMeter);
        });
      } else {
        animFrameRef.current = requestAnimationFrame(updateMeter);
      }
    } catch {
      logDiagnostic('warn', 'media_meter_failed', { error_code: 'AUDIO_CONTEXT_FAILED' });
    }
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    logDiagnostic('info', 'media_permission_request');
    setStatus('requesting');
    setErrorMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      logDiagnostic('warn', 'media_permission_failed', { error_code: 'MEDIA_API_UNAVAILABLE' });
      setStatus('error');
      setErrorMessage('Media devices API is not supported in this browser. Please use Chrome, Edge, Firefox, or Safari.');
      return false;
    }

    try {
      // Request both audio and video
      const userStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = userStream;
      setStream(userStream);
      setStatus('granted');
      setIsMuted(false);
      setIsVideoOff(false);
      logDiagnostic('info', 'media_permission_granted', { outcome: 'success' });

      setupAudioMeter(userStream);
      return true;
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      logDiagnostic('warn', 'media_permission_failed', {
        error_code: error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
          ? 'PERMISSION_DENIED' : error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError'
          ? 'DEVICE_NOT_FOUND' : 'MEDIA_REQUEST_FAILED',
        outcome: 'failure',
      });

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setStatus('denied');
        setErrorMessage('Camera or Microphone access was denied by your browser. Please allow device access in browser settings to continue.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setStatus('error');
        setErrorMessage('No camera or microphone hardware found on this system. Please connect an audio/video device.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setStatus('error');
        setErrorMessage('Your camera or microphone is already in use by another application. Please close other video apps and retry.');
      } else {
        setStatus('error');
        setErrorMessage(error.message || 'An unknown error occurred while requesting device permissions.');
      }
      return false;
    }
  }, [setupAudioMeter]);

  const toggleMute = useCallback(() => {
    if (!streamRef.current) return;
    const audioTracks = streamRef.current.getAudioTracks();
    const nextMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    logDiagnostic('info', 'media_muted', { muted: nextMuted });
    if (nextMuted) {
      setAudioLevel(0);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(() => {
    if (!streamRef.current) return;
    const videoTracks = streamRef.current.getVideoTracks();
    const nextVideoOff = !isVideoOff;
    videoTracks.forEach((track) => {
      track.enabled = !nextVideoOff;
    });
    setIsVideoOff(nextVideoOff);
    logDiagnostic('info', 'media_video_toggled', { video_off: nextVideoOff });
  }, [isVideoOff]);

  useEffect(() => {
    let timeoutId: number | undefined;
    if (autoStart) {
      timeoutId = window.setTimeout(() => {
        void requestPermissions();
      }, 0);
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      stopAllTracks();
    };
  }, [autoStart, requestPermissions, stopAllTracks]);

  return {
    stream,
    status,
    errorMessage,
    isMuted,
    isVideoOff,
    audioLevel,
    requestPermissions,
    toggleMute,
    toggleVideo,
    stopAllTracks,
  };
}
