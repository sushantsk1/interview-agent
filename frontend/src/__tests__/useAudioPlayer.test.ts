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
