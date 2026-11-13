import { useState, useRef, useCallback, useEffect } from 'react';

import { diagnosticNow, logDiagnostic } from '../services/diagnostics';

export interface AudioDiagnosticContext {
  connection_id?: string;
  turn_index?: number;
}

export interface UseAudioPlayerOptions {
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
  onError?: (error: unknown) => void;
}

export interface UseAudioPlayerReturn {
  isPlaying: boolean;
  isBlocked: boolean;
  queueLength: number;
  queueAudio: (base64Data: string, format?: string, context?: AudioDiagnosticContext) => void;
  resumeAudio: () => void;
  stopAudio: () => void;
  clearQueue: () => void;
}

interface AudioQueueItem {
  data: string;
  format: string;
  context: AudioDiagnosticContext;
}

/**
 * Hook to queue and sequentially play base64-encoded audio chunks (e.g. TTS Aura-2 MP3 audio)
 * using HTML5 Audio. Triggers playback callbacks to coordinate speaking/listening agent states.
 * Adheres to CONTRACT.md Section 3.2: audio payload.
 */
export function useAudioPlayer(options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [queueLength, setQueueLength] = useState(0);

  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentItemRef = useRef<AudioQueueItem | null>(null);
  const playbackStartedAtRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const playNextChunkRef = useRef<() => void>(() => {});
  const playbackGenerationRef = useRef(0);

  const onPlaybackStartedRef = useRef(options.onPlaybackStarted);
  const onPlaybackEndedRef = useRef(options.onPlaybackEnded);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onPlaybackStartedRef.current = options.onPlaybackStarted;
  }, [options.onPlaybackStarted]);

  useEffect(() => {
    onPlaybackEndedRef.current = options.onPlaybackEnded;
  }, [options.onPlaybackEnded]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const startPlayback = useCallback((audio: HTMLAudioElement, context: AudioDiagnosticContext) => {
    const generation = playbackGenerationRef.current;
    logDiagnostic('info', 'audio_play_attempt', context);
    try {
      const playPromise = audio.play();
      const markStarted = () => {
        if (playbackGenerationRef.current !== generation || currentAudioRef.current !== audio) return;
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsBlocked(false);
        playbackStartedAtRef.current = diagnosticNow();
        logDiagnostic('info', 'audio_play_start', context);
        onPlaybackStartedRef.current?.();
      };
      if (playPromise !== undefined) {
        playPromise.then(markStarted).catch((err) => {
          if (playbackGenerationRef.current !== generation || currentAudioRef.current !== audio) return;
          isPlayingRef.current = false;
          setIsPlaying(false);
          const blocked = err instanceof DOMException && err.name === 'NotAllowedError';
          setIsBlocked(blocked);
          if (!blocked) currentAudioRef.current = null;
          logDiagnostic(blocked ? 'warn' : 'error', blocked ? 'audio_play_blocked' : 'audio_play_failed', {
            ...context, error_code: blocked ? 'AUTOPLAY_BLOCKED' : 'PLAY_FAILED',
          });
          onErrorRef.current?.(err);
        });
      } else {
        markStarted();
      }
    } catch (err) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      const blocked = err instanceof DOMException && err.name === 'NotAllowedError';
      setIsBlocked(blocked);
      if (!blocked) currentAudioRef.current = null;
      logDiagnostic(blocked ? 'warn' : 'error', blocked ? 'audio_play_blocked' : 'audio_play_failed', {
        ...context, error_code: blocked ? 'AUTOPLAY_BLOCKED' : 'PLAY_FAILED',
      });
      onErrorRef.current?.(err);
    }
  }, []);

  const playNextChunk = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBlocked(false);
      setQueueLength(0);
      currentAudioRef.current = null;
      currentItemRef.current = null;
      onPlaybackEndedRef.current?.();
      return;
    }

    const nextItem = audioQueueRef.current.shift()!;
    currentItemRef.current = nextItem;
    setQueueLength(audioQueueRef.current.length);

    if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
      // In non-browser / headless environment without Audio polyfill, advance immediately
      setTimeout(() => playNextChunkRef.current(), 50);
      return;
    }

    try {
      const mime = nextItem.format || 'audio/mp3';
      const audioUrl = nextItem.data.startsWith('data:')
        ? nextItem.data
        : `data:${mime};base64,${nextItem.data}`;

      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        if (currentAudioRef.current !== audio) return;
        logDiagnostic('info', 'audio_play_end', {
          ...nextItem.context,
          elapsed_ms: playbackStartedAtRef.current === null ? undefined : diagnosticNow() - playbackStartedAtRef.current,
        });
        playbackStartedAtRef.current = null;
        currentItemRef.current = null;
        currentAudioRef.current = null;
        playNextChunkRef.current();
      };

      audio.onerror = (e) => {
        if (currentAudioRef.current !== audio) return;
        currentAudioRef.current = null;
        currentItemRef.current = null;
        isPlayingRef.current = false;
        setIsPlaying(false);
        logDiagnostic('error', 'audio_play_failed', { ...nextItem.context, error_code: 'AUDIO_DECODE_FAILED' });
        onErrorRef.current?.(e);
        playNextChunkRef.current();
      };
      startPlayback(audio, nextItem.context);
    } catch (err) {
      logDiagnostic('error', 'audio_play_failed', { ...nextItem.context, error_code: 'AUDIO_CREATE_FAILED' });
      onErrorRef.current?.(err);
      playNextChunkRef.current();
    }
  }, [startPlayback]);

  useEffect(() => {
    playNextChunkRef.current = playNextChunk;
  }, [playNextChunk]);

  const queueAudio = useCallback(
    (base64Data: string, format = 'audio/mp3', context: AudioDiagnosticContext = {}) => {
      if (!base64Data) return;

      audioQueueRef.current.push({ data: base64Data, format, context });
      setQueueLength(audioQueueRef.current.length);
      logDiagnostic('info', 'audio_queued', { ...context, byte_count: Math.floor(base64Data.length * 3 / 4), queue_length: audioQueueRef.current.length });

      if (!isPlayingRef.current && !currentAudioRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk]
  );

  const resumeAudio = useCallback(() => {
    if (currentAudioRef.current && !isPlayingRef.current) {
      logDiagnostic('info', 'audio_retry', currentItemRef.current?.context);
      startPlayback(currentAudioRef.current, currentItemRef.current?.context || {});
    } else if (!currentAudioRef.current && audioQueueRef.current.length > 0) {
      playNextChunk();
    }
  }, [startPlayback, playNextChunk]);

  const stopAudio = useCallback(() => {
    playbackGenerationRef.current += 1;
    if (currentAudioRef.current || audioQueueRef.current.length > 0) {
      logDiagnostic('debug', 'audio_stop', currentItemRef.current?.context);
    }
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
      } catch {
        logDiagnostic('warn', 'audio_play_failed', { ...currentItemRef.current?.context, error_code: 'AUDIO_STOP_FAILED' });
      }
      currentAudioRef.current = null;
    }
    currentItemRef.current = null;
    playbackStartedAtRef.current = null;
    audioQueueRef.current = [];
    setQueueLength(0);
    setIsBlocked(false);
    const wasPlaying = isPlayingRef.current;
    isPlayingRef.current = false;
    setIsPlaying(false);

    if (wasPlaying) {
      onPlaybackEndedRef.current?.();
    }
  }, []);

  const clearQueue = useCallback(() => {
    audioQueueRef.current = [];
    setQueueLength(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.src = '';
        } catch {
          // ignore
        }
      }
      audioQueueRef.current = [];
    };
  }, []);

  return {
    isPlaying,
    isBlocked,
    queueLength,
    queueAudio,
    resumeAudio,
    stopAudio,
    clearQueue,
  };
}
