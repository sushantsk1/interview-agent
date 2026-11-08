import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseAudioPlayerOptions {
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
  onError?: (error: unknown) => void;
}

export interface UseAudioPlayerReturn {
  isPlaying: boolean;
  queueLength: number;
  queueAudio: (base64Data: string, format?: string) => void;
  stopAudio: () => void;
  clearQueue: () => void;
}

interface AudioQueueItem {
  data: string;
  format: string;
}

/**
 * Hook to queue and sequentially play base64-encoded audio chunks (e.g. TTS Aura-2 MP3 audio)
 * using HTML5 Audio. Triggers playback callbacks to coordinate speaking/listening agent states.
 * Adheres to CONTRACT.md Section 3.2: audio payload.
 */
export function useAudioPlayer(options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueLength, setQueueLength] = useState(0);

  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const playNextChunkRef = useRef<() => void>(() => {});

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

  const playNextChunk = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setQueueLength(0);
      currentAudioRef.current = null;
      onPlaybackEndedRef.current?.();
      return;
    }

    const nextItem = audioQueueRef.current.shift()!;
    setQueueLength(audioQueueRef.current.length);

    const wasAlreadyPlaying = isPlayingRef.current;
    isPlayingRef.current = true;
    setIsPlaying(true);

    if (!wasAlreadyPlaying) {
      onPlaybackStartedRef.current?.();
    }

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
        playNextChunkRef.current();
      };

      audio.onerror = (e) => {
        console.warn('Audio playback error on chunk, skipping to next:', e);
        onErrorRef.current?.(e);
        playNextChunkRef.current();
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Audio play request blocked or failed:', err);
          onErrorRef.current?.(err);
          playNextChunkRef.current();
        });
      }
    } catch (err) {
      console.warn('Failed to construct or play Audio instance:', err);
      onErrorRef.current?.(err);
      playNextChunkRef.current();
    }
  }, []);

  useEffect(() => {
    playNextChunkRef.current = playNextChunk;
  }, [playNextChunk]);

  const queueAudio = useCallback(
    (base64Data: string, format = 'audio/mp3') => {
      if (!base64Data) return;

      audioQueueRef.current.push({ data: base64Data, format });
      setQueueLength(audioQueueRef.current.length);

      if (!isPlayingRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk]
  );

  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
      } catch (err) {
        console.warn('Error pausing current audio:', err);
      }
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    setQueueLength(0);
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
    queueLength,
    queueAudio,
    stopAudio,
    clearQueue,
  };
}
