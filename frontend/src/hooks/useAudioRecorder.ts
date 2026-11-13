import { useState, useEffect, useRef, useCallback } from 'react';

import { logDiagnostic } from '../services/diagnostics';

export interface UseAudioRecorderOptions {
  stream: MediaStream | null;
  isEnabled: boolean;
  timeslice?: number; // Chunk interval in ms (default 250ms)
  onAudioChunk: (chunk: { data: string; format: string }) => void;
  onError?: (error: unknown) => void;
}

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  mimeType: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Hook to record microphone audio chunks from a MediaStream using MediaRecorder
 * and stream base64-encoded audio chunks at short intervals (250ms) for low-latency STT.
 * Adheres to CONTRACT.md Section 3.1: audio_chunk format.
 */
export function useAudioRecorder({
  stream,
  isEnabled,
  timeslice = 250,
  onAudioChunk,
  onError,
}: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('audio/webm;codecs=opus');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const onAudioChunkRef = useRef(onAudioChunk);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Determine best supported MIME type
  const getSupportedMimeType = useCallback((): string => {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return 'audio/webm;codecs=opus';
    }
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      '',
    ];
    for (const t of types) {
      if (!t || MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return 'audio/webm';
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
        logDiagnostic('info', 'media_recorder_stop');
      } catch {
        logDiagnostic('warn', 'media_recorder_failed', { error_code: 'RECORDER_STOP_FAILED' });
      }
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    if (!stream) {
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      const err = new Error('MediaRecorder is not supported in this environment');
      logDiagnostic('warn', 'media_recorder_failed', { error_code: 'RECORDER_UNAVAILABLE' });
      setError(err.message);
      onErrorRef.current?.(err);
      return;
    }

    try {
      // Stop previous instance if running
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }

      const selectedMime = getSupportedMimeType();
      setMimeType(selectedMime || 'audio/webm');

      // Create isolated audio-only stream to avoid video frame overhead
      const audioOnlyStream =
        typeof MediaStream !== 'undefined'
          ? new MediaStream([audioTracks[0]])
          : stream;
      const recorderOptions: MediaRecorderOptions = selectedMime ? { mimeType: selectedMime } : {};
      const recorder = new MediaRecorder(audioOnlyStream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            if (result) {
              const base64Data = result.includes(',') ? result.split(',')[1] : result;
              if (base64Data) {
                onAudioChunkRef.current({
                  data: base64Data,
                  format: selectedMime || 'audio/webm',
                });
              }
            }
          };
          reader.onerror = () => {
            logDiagnostic('warn', 'media_recorder_failed', { error_code: 'CHUNK_READ_FAILED' });
          };
          reader.readAsDataURL(event.data);
        }
      };

      recorder.onerror = (recErr: Event) => {
        logDiagnostic('warn', 'media_recorder_failed', { error_code: 'RECORDER_RUNTIME_FAILED' });
        setError('MediaRecorder encountered an error');
        onErrorRef.current?.(recErr);
        setIsRecording(false);
      };

      recorder.onstop = () => {
        setIsRecording(false);
      };

      recorder.start(timeslice);
      logDiagnostic('info', 'media_recorder_start');
      setIsRecording(true);
      setError(null);
    } catch (err) {
      logDiagnostic('warn', 'media_recorder_failed', { error_code: 'RECORDER_START_FAILED' });
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      onErrorRef.current?.(err);
      setIsRecording(false);
    }
  }, [stream, getSupportedMimeType, timeslice]);

  // Synchronize recording state with isEnabled & stream availability
  useEffect(() => {
    if (isEnabled && stream) {
      start();
    } else {
      stop();
    }

    return () => {
      stop();
    };
  }, [isEnabled, stream, start, stop]);

  return {
    isRecording,
    mimeType,
    error,
    start,
    stop,
  };
}
