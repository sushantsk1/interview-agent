import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

describe('useAudioPlayer hook (AC-009, AC-010)', () => {
  let originalAudio: typeof Audio;
  let audioInstances: any[] = [];

  class MockAudio {
    src: string;
    onended: (() => void) | null = null;
    onerror: ((err: any) => void) | null = null;
    paused = true;

    constructor(src: string) {
      this.src = src;
      audioInstances.push(this);
    }

    play = vi.fn().mockImplementation(() => {
      this.paused = false;
      return Promise.resolve();
    });

    pause = vi.fn().mockImplementation(() => {
      this.paused = true;
    });
  }

  beforeEach(() => {
    audioInstances = [];
    originalAudio = window.Audio;
    (window as any).Audio = MockAudio;
  });

  afterEach(() => {
    (window as any).Audio = originalAudio;
    vi.clearAllMocks();
  });

  it('queues audio chunk, invokes onPlaybackStarted, and sets isPlaying to true', async () => {
    const onPlaybackStarted = vi.fn();
    const onPlaybackEnded = vi.fn();

    const { result } = renderHook(() =>
      useAudioPlayer({
        onPlaybackStarted,
        onPlaybackEnded,
      })
    );

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.queueLength).toBe(0);

    act(() => {
      result.current.queueAudio('BASE64_AUDIO_CHUNK_1', 'audio/mp3');
    });

    expect(result.current.isPlaying).toBe(true);
    expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
    expect(audioInstances.length).toBe(1);
    expect(audioInstances[0].src).toBe('data:audio/mp3;base64,BASE64_AUDIO_CHUNK_1');
  });

  it('plays sequential audio chunks and triggers onPlaybackEnded when queue finishes', async () => {
    const onPlaybackStarted = vi.fn();
    const onPlaybackEnded = vi.fn();

    const { result } = renderHook(() =>
      useAudioPlayer({
        onPlaybackStarted,
        onPlaybackEnded,
      })
    );

    act(() => {
      result.current.queueAudio('CHUNK_1');
      result.current.queueAudio('CHUNK_2');
    });

    expect(audioInstances.length).toBe(1);
    expect(result.current.isPlaying).toBe(true);

    // End chunk 1
    act(() => {
      audioInstances[0].onended?.();
    });

    // Chunk 2 should now be playing
    expect(audioInstances.length).toBe(2);
    expect(audioInstances[1].src).toBe('data:audio/mp3;base64,CHUNK_2');
    expect(result.current.isPlaying).toBe(true);

    // End chunk 2
    act(() => {
      audioInstances[1].onended?.();
    });

    // Queue is empty, playback finished
    expect(result.current.isPlaying).toBe(false);
    expect(onPlaybackEnded).toHaveBeenCalledTimes(1);
  });

  it('stops playback and clears audio queue on stopAudio()', async () => {
    const onPlaybackEnded = vi.fn();

    const { result } = renderHook(() =>
      useAudioPlayer({
        onPlaybackEnded,
      })
    );

    act(() => {
      result.current.queueAudio('CHUNK_A');
      result.current.queueAudio('CHUNK_B');
    });

    expect(result.current.isPlaying).toBe(true);
    expect(audioInstances[0].play).toHaveBeenCalled();

    act(() => {
      result.current.stopAudio();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.queueLength).toBe(0);
    expect(audioInstances[0].pause).toHaveBeenCalled();
    expect(onPlaybackEnded).toHaveBeenCalled();
  });
});

// Arbitrary network packet boundaries must not become independent audio files.
describe('streaming PCM playback', () => {
  const sources: any[] = [];
  const buffers: any[] = [];
  let ctx: any;
  const encode = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
  beforeEach(() => {
    sources.length = 0;
    buffers.length = 0;
    ctx = {
      currentTime: 2, state: 'running', destination: {},
      resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
      createBuffer: vi.fn((_channels, length, rate) => {
        const data = new Float32Array(length);
        const buffer = { duration: length / rate, getChannelData: () => data };
        buffers.push(buffer); return buffer;
      }),
      createBufferSource: vi.fn(() => {
        const source = { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        sources.push(source); return source;
      }),
    };
    vi.stubGlobal('AudioContext', class { constructor() { return ctx; } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts before final, joins split samples and holds speaking through packet gaps', () => {
    const ended = vi.fn();
    const streamEnded = vi.fn();
    const { result } = renderHook(() => useAudioPlayer({ onPlaybackEnded: ended, onStreamEnded: streamEnded }));
    act(() => result.current.queueAudio(encode([0, 64, 255]), 'audio/pcm', { streamId: 'q1', sampleRate: 24000 }));
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(2);
    expect(buffers[0].getChannelData(0)[0]).toBe(.5);
    act(() => sources[0].onended());
    expect(result.current.isPlaying).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    act(() => result.current.queueAudio(encode([127]), 'audio/pcm', { streamId: 'q1', sampleRate: 24000 }));
    expect(buffers[1].getChannelData(0)[0]).toBeCloseTo(32767 / 32768);
    expect(sources[1].start).toHaveBeenCalledWith(2 + 1 / 24000);
    act(() => result.current.queueAudio('', 'audio/pcm', { streamId: 'q1', isFinalChunk: true }));
    expect(streamEnded).not.toHaveBeenCalled();
    act(() => sources[1].onended());
    expect(streamEnded).toHaveBeenCalledExactlyOnceWith('q1');
    expect(result.current.isPlaying).toBe(false);
    act(() => result.current.queueAudio('', 'audio/pcm', { streamId: 'q1', isFinalChunk: true }));
    expect(streamEnded).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a late empty final marker only after already scheduled audio drained', () => {
    const ended = vi.fn();
    const { result } = renderHook(() => useAudioPlayer({ onStreamEnded: ended }));
    act(() => result.current.queueAudio(encode([0, 0]), 'audio/pcm', { streamId: 'q2' }));
    act(() => sources[0].onended());
    expect(ended).not.toHaveBeenCalled();
    act(() => result.current.queueAudio('', 'audio/pcm', { streamId: 'q2', isFinalChunk: true }));
    expect(ended).toHaveBeenCalledExactlyOnceWith('q2');
  });

  it('stops scheduled audio without acknowledging cancelled streams', () => {
    const ended = vi.fn();
    const { result, unmount } = renderHook(() => useAudioPlayer({ onStreamEnded: ended }));
    act(() => result.current.queueAudio(encode([0, 0]), 'audio/pcm', { streamId: 'q3', isFinalChunk: true }));
    unmount();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    expect(sources[0].onended).toBeNull();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it('recovers unavailable speech through an explicit text choice and waits for final', () => {
    const ended = vi.fn();
    const { result } = renderHook(() => useAudioPlayer({ onStreamEnded: ended }));
    act(() => result.current.failAudio('failed-stream'));
    expect(result.current.playbackError).toMatch(/Continue with text/);
    act(() => result.current.skipAudio());
    expect(ended).not.toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);
    act(() => result.current.queueAudio('', 'audio/pcm', { streamId: 'failed-stream', isFinalChunk: true }));
    expect(ended).toHaveBeenCalledExactlyOnceWith('failed-stream');
    expect(result.current.isPlaying).toBe(false);
  });

  it('does not acknowledge malformed PCM until user explicitly skips voice', () => {
    const ended = vi.fn();
    const { result } = renderHook(() => useAudioPlayer({ onStreamEnded: ended }));
    act(() => result.current.queueAudio(encode([0]), 'audio/pcm', { streamId: 'bad', isFinalChunk: true }));
    expect(ended).not.toHaveBeenCalled();
    expect(result.current.playbackError).toMatch(/Continue with text/);
    act(() => result.current.skipAudio());
    expect(ended).toHaveBeenCalledExactlyOnceWith('bad');
  });

  it('retains blocked audio and offers retry without premature completion', async () => {
    ctx.state = 'suspended';
    ctx.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    const ended = vi.fn();
    const { result } = renderHook(() => useAudioPlayer({ onStreamEnded: ended }));
    await act(async () => result.current.queueAudio(encode([0, 0]), 'audio/pcm', { streamId: 'q4', isFinalChunk: true }));
    expect(result.current.playbackError).toMatch(/Enable audio/);
    expect(ended).not.toHaveBeenCalled();
    await act(async () => result.current.retryAudio());
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(result.current.playbackError).toBeNull();
    act(() => sources[0].onended());
    expect(ended).toHaveBeenCalledExactlyOnceWith('q4');
  });
});
