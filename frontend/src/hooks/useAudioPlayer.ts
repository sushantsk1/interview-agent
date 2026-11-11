import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioChunkMetadata {
  streamId?: string;
  sampleRate?: number;
  isFinalChunk?: boolean;
}
export interface UseAudioPlayerOptions {
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
  onStreamEnded?: (streamId: string) => void;
  onError?: (error: unknown) => void;
}
export interface UseAudioPlayerReturn {
  isPlaying: boolean;
  queueLength: number;
  playbackError: string | null;
  queueAudio: (data: string, format?: string, metadata?: AudioChunkMetadata) => void;
  retryAudio: () => void;
  skipAudio: () => void;
  failAudio: (streamId: string) => void;
  stopAudio: () => void;
  clearQueue: () => void;
}
interface PCMStream {
  id: string;
  final: boolean;
  skipped?: boolean;
  failed?: boolean;
  remainder?: number;
  sources: Set<AudioBufferSourceNode>;
}

/** PCM packets are parts of one continuous stream, not standalone audio files. */
export function useAudioPlayer(options: UseAudioPlayerOptions = {}): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  const playing = useRef(false);
  const mounted = useRef(true);
  const context = useRef<AudioContext | null>(null);
  const scheduledUntil = useRef(0);
  const streams = useRef(new Map<string, PCMStream>());
  const finished = useRef(new Set<string>());
  const legacyQueue = useRef<Array<{ data: string; format: string }>>([]);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0);
  const playNext = useRef<() => void>(() => {});

  const markPlaying = useCallback(() => {
    if (!playing.current) {
      playing.current = true;
      setIsPlaying(true);
      callbacks.current.onPlaybackStarted?.();
    }
  }, []);
  const reportError = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setPlaybackError('Audio playback unavailable. Select Enable audio to retry or Continue with text.');
    callbacks.current.onError?.(error);
  }, []);
  const finishIfDrained = useCallback(() => {
    for (const [id, stream] of streams.current) {
      if (stream.final && stream.sources.size === 0 && (!stream.failed || stream.skipped)) {
        streams.current.delete(id);
        finished.current.add(id);
        callbacks.current.onStreamEnded?.(id);
      }
    }
    setQueueLength(legacyQueue.current.length + [...streams.current.values()].reduce((n, s) => n + s.sources.size, 0));
    if (streams.current.size === 0 && !currentAudio.current && legacyQueue.current.length === 0 && playing.current) {
      playing.current = false;
      setIsPlaying(false);
      callbacks.current.onPlaybackEnded?.();
    }
  }, []);

  const resumeContext = useCallback(() => {
    const ctx = context.current;
    if (!ctx) return;
    const epoch = generation.current;
    if (ctx.state === 'suspended') setPlaybackError('Audio playback unavailable. Select Enable audio to retry or Continue with text.');
    void ctx.resume().then(() => {
      if (mounted.current && epoch === generation.current) setPlaybackError(null);
    }).catch((error: unknown) => {
      if (epoch === generation.current) reportError(error);
    });
  }, [reportError]);

  const playLegacy = useCallback(() => {
    const item = legacyQueue.current.shift();
    if (!item) { currentAudio.current = null; finishIfDrained(); return; }
    setQueueLength(legacyQueue.current.length);
    markPlaying();
    const audio = new Audio(item.data.startsWith('data:') ? item.data : `data:${item.format};base64,${item.data}`);
    currentAudio.current = audio;
    audio.onended = () => {
      if (currentAudio.current !== audio) return;
      currentAudio.current = null;
      playNext.current();
    };
    audio.onerror = (error) => { if (currentAudio.current === audio) reportError(error); };
    void audio.play()?.catch(reportError);
  }, [finishIfDrained, markPlaying, reportError]);
  playNext.current = playLegacy;

  const queueAudio = useCallback((data: string, format = 'audio/mp3', metadata: AudioChunkMetadata = {}) => {
    if (format !== 'audio/pcm') {
      if (!data) return;
      legacyQueue.current.push({ data, format });
      setQueueLength(legacyQueue.current.length);
      if (!currentAudio.current) playLegacy();
      return;
    }
    const id = metadata.streamId;
    if (!id || finished.current.has(id)) return;
    let stream = streams.current.get(id);
    if (!stream) {
      stream = { id, final: false, sources: new Set() };
      streams.current.set(id, stream);
      markPlaying();
    }
    try {
      if (metadata.isFinalChunk) stream.final = true;
      if (stream.skipped) { finishIfDrained(); return; }
      if (stream.failed) return;
      if (data) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length + (stream.remainder === undefined ? 0 : 1));
        let offset = 0;
        if (stream.remainder !== undefined) bytes[offset++] = stream.remainder;
        for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
        const sampleCount = Math.floor(bytes.length / 2);
        stream.remainder = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
        if (sampleCount) {
          if (!context.current) {
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!AudioContextClass) throw new Error('This browser does not support streaming audio.');
            context.current = new AudioContextClass();
          }
          const ctx = context.current;
          const buffer = ctx.createBuffer(1, sampleCount, metadata.sampleRate || 24000);
          const samples = buffer.getChannelData(0);
          const view = new DataView(bytes.buffer);
          for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          const targetStream = stream;
          targetStream.sources.add(source);
          source.onended = () => {
            source.disconnect();
            if (!mounted.current || !streams.current.has(id)) return;
            targetStream.sources.delete(source);
            finishIfDrained();
          };
          const startsAt = Math.max(ctx.currentTime, scheduledUntil.current);
          source.start(startsAt);
          scheduledUntil.current = startsAt + buffer.duration;
          if (ctx.state === 'suspended') resumeContext();
        }
      }
      if (metadata.isFinalChunk) {
        if (stream.remainder !== undefined) throw new Error('Incomplete PCM sample at end of audio stream.');
      }
      finishIfDrained();
    } catch (error) {
      stream.failed = true;
      reportError(error);
    }
  }, [finishIfDrained, markPlaying, playLegacy, reportError, resumeContext]);

  const retryAudio = useCallback(() => {
    if (context.current) resumeContext();
    if (currentAudio.current) void currentAudio.current.play().then(() => setPlaybackError(null)).catch(reportError);
  }, [reportError, resumeContext]);

  const failAudio = useCallback((streamId: string) => {
    let stream = streams.current.get(streamId);
    if (!stream) {
      stream = { id: streamId, final: false, sources: new Set() };
      streams.current.set(streamId, stream);
      markPlaying();
    }
    stream.failed = true;
    reportError(new Error('Speech generation failed.'));
  }, [markPlaying, reportError]);

  // Explicit user choice: discard voice but wait for the stream's final marker
  // before acknowledging it, so the server cannot accept an answer mid-question.
  const skipAudio = useCallback(() => {
    for (const stream of streams.current.values()) {
      stream.skipped = true;
      stream.remainder = undefined;
      for (const source of stream.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* A failed source may not have started. */ }
        source.disconnect();
      }
      stream.sources.clear();
    }
    if (currentAudio.current) {
      currentAudio.current.onended = null;
      currentAudio.current.onerror = null;
      currentAudio.current.pause();
      currentAudio.current.src = '';
      currentAudio.current = null;
    }
    legacyQueue.current = [];
    scheduledUntil.current = 0;
    setPlaybackError(null);
    finishIfDrained();
  }, [finishIfDrained]);

  const stopAudio = useCallback(() => {
    generation.current++;
    if (currentAudio.current) {
      currentAudio.current.onended = null;
      currentAudio.current.onerror = null;
      currentAudio.current.pause();
      currentAudio.current.src = '';
      currentAudio.current = null;
    }
    for (const stream of streams.current.values()) {
      for (const source of stream.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* A failed source may not have started. */ }
        source.disconnect();
      }
    }
    streams.current.clear();
    finished.current.clear();
    legacyQueue.current = [];
    scheduledUntil.current = 0;
    const ctx = context.current;
    context.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
    const wasPlaying = playing.current;
    playing.current = false;
    if (mounted.current) {
      setIsPlaying(false);
      setQueueLength(0);
      setPlaybackError(null);
      if (wasPlaying) callbacks.current.onPlaybackEnded?.();
    }
  }, []);
  const clearQueue = useCallback(() => { legacyQueue.current = []; setQueueLength(0); }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopAudio(); };
  }, [stopAudio]);
  return { isPlaying, queueLength, playbackError, queueAudio, retryAudio, skipAudio, failAudio, stopAudio, clearQueue };
}
