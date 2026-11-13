import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInterviewWebSocket } from '../hooks/useInterviewWebSocket';

describe('useInterviewWebSocket hook (AC-008 to AC-014, AC-022, AC-026)', () => {
  let originalWebSocket: typeof WebSocket;
  let mockWsInstances: MockWebSocket[] = [];

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    url: string;
    readyState: number = WebSocket.CONNECTING;
    onopen: ((event: any) => void) | null = null;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onclose: ((event: any) => void) | null = null;
    sentMessages: string[] = [];

    constructor(url: string) {
      this.url = url;
      mockWsInstances.push(this);
    }

    send = vi.fn((data: string) => {
      this.sentMessages.push(data);
    });

    close = vi.fn((code = 1000, reason = '') => {
      this.readyState = WebSocket.CLOSED;
      this.onclose?.({ code, reason } as any);
    });

    // Test simulation helpers
    triggerOpen() {
      this.readyState = WebSocket.OPEN;
      this.onopen?.({} as any);
    }

    triggerMessage(data: object) {
      this.onmessage?.({ data: JSON.stringify(data) } as any);
    }

    triggerError(error: any) {
      this.onerror?.(error);
    }

    triggerClose(code = 1000, reason = 'Normal') {
      this.readyState = WebSocket.CLOSED;
      this.onclose?.({ code, reason } as any);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstances = [];
    originalWebSocket = window.WebSocket;
    (window as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as any).WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  it('connects to endpoint and dispatches start handshake on open', () => {
    const { result } = renderHook(() =>
      useInterviewWebSocket({
        token: 'test-token-123',
        candidateName: 'Jane Doe',
        candidateEmail: 'jane@example.com',
      })
    );

    expect(mockWsInstances.length).toBe(1);
    const ws = mockWsInstances[0];
    expect(ws.url).toContain('/ws/interview/test-token-123');

    act(() => {
      ws.triggerOpen();
    });

    expect(result.current.isConnected).toBe(true);
    expect(ws.sentMessages.length).toBe(1);
    const handshake = JSON.parse(ws.sentMessages[0]);
    expect(handshake).toEqual({
      type: 'start',
      candidate_name: 'Jane Doe',
      candidate_email: 'jane@example.com',
    });
  });

  it('routes status, question, audio, transcript, and silence_tick messages', () => {
    const onStatus = vi.fn();
    const onQuestion = vi.fn();
    const onAudio = vi.fn();
    const onTranscript = vi.fn();
    const onSilenceTick = vi.fn();

    renderHook(() =>
      useInterviewWebSocket({
        token: 'test-token',
        candidateName: 'Candidate',
        candidateEmail: 'candidate@example.com',
        onStatus,
        onQuestion,
        onAudio,
        onTranscript,
        onSilenceTick,
      })
    );

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      ws.triggerMessage({
        type: 'status',
        state: 'listening',
        question_index: 2,
        total_questions: 8,
        time_elapsed_seconds: 45,
      });
    });
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'listening', question_index: 2 })
    );

    act(() => {
      ws.triggerMessage({
        type: 'question',
        turn_index: 2,
        topic: 'Python Concurrency',
        text: 'How does asyncio compare with threading?',
        is_follow_up: false,
      });
    });
    expect(onQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'Python Concurrency', text: expect.stringContaining('asyncio') })
    );

    act(() => {
      ws.triggerMessage({
        type: 'audio',
        turn_index: 2,
        data: 'TTS_BASE64_DATA',
        format: 'audio/mp3',
        is_final_chunk: false,
      });
    });
    expect(onAudio).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'TTS_BASE64_DATA', format: 'audio/mp3' })
    );

    act(() => {
      ws.triggerMessage({
        type: 'transcript',
        speaker: 'candidate',
        text: 'Asyncio uses an event loop...',
        is_final: true,
      });
    });
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ speaker: 'candidate', is_final: true })
    );

    act(() => {
      ws.triggerMessage({
        type: 'silence_tick',
        silence_seconds: 2.0,
        threshold_seconds: 2.75,
      });
    });
    expect(onSilenceTick).toHaveBeenCalledWith(
      expect.objectContaining({ silence_seconds: 2.0, threshold_seconds: 2.75 })
    );
  });

  it('sends audio_chunk, done_answering, text_fallback, and mute_toggle payloads', () => {
    const { result } = renderHook(() =>
      useInterviewWebSocket({
        token: 'test-token',
        candidateName: 'Jane',
        candidateEmail: 'jane@example.com',
      })
    );

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    // Send audio chunk
    act(() => {
      result.current.sendAudioChunk('BASE64_OPUS', 'audio/webm;codecs=opus');
    });
    expect(JSON.parse(ws.sentMessages[1])).toEqual({
      type: 'audio_chunk',
      data: 'BASE64_OPUS',
      format: 'audio/webm;codecs=opus',
    });

    // Send done answering (AC-013)
    act(() => {
      result.current.sendDoneAnswering();
    });
    expect(JSON.parse(ws.sentMessages[2])).toEqual({
      type: 'done_answering',
    });

    // Send text fallback (AC-026)
    act(() => {
      result.current.sendTextFallback('Typed response');
    });
    expect(JSON.parse(ws.sentMessages[3])).toEqual({
      type: 'text_fallback',
      text: 'Typed response',
    });

    // Send mute toggle (AC-014)
    act(() => {
      result.current.sendMuteToggle(true);
    });
    expect(JSON.parse(ws.sentMessages[4])).toEqual({
      type: 'mute_toggle',
      muted: true,
    });
  });

  it('dispatches ping heartbeat every 20 seconds as specified in CONTRACT.md', () => {
    renderHook(() =>
      useInterviewWebSocket({
        token: 'test-token',
        candidateName: 'Jane',
        candidateEmail: 'jane@example.com',
      })
    );

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    expect(ws.sentMessages.length).toBe(1); // start payload

    // Fast-forward 20 seconds
    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(ws.sentMessages.length).toBe(2);
    expect(JSON.parse(ws.sentMessages[1])).toEqual({ type: 'ping' });

    // Fast-forward another 20 seconds
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(ws.sentMessages.length).toBe(3);
    expect(JSON.parse(ws.sentMessages[2])).toEqual({ type: 'ping' });
  });

  it('attempts reconnection on abnormal socket close (AC-026)', () => {
    const { result } = renderHook(() =>
      useInterviewWebSocket({
        token: 'test-token',
        candidateName: 'Jane',
        candidateEmail: 'jane@example.com',
        autoReconnect: true,
      })
    );

    const ws1 = mockWsInstances[0];
    act(() => {
      ws1.triggerOpen();
    });
    expect(result.current.isConnected).toBe(true);

    // Simulate unexpected drop (code 1006)
    act(() => {
      ws1.triggerClose(1006, 'Abnormal Closure');
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionError).toContain('Connection lost. Retrying');

    // Advance backoff timer (1s for first attempt)
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    // A second socket should have been instantiated for reconnection
    expect(mockWsInstances.length).toBe(2);
  });

  it('ignores delayed messages from an obsolete socket after reconnect', () => {
    const onAudio = vi.fn();
    const { result } = renderHook(() => useInterviewWebSocket({
      token: 'test-token',
      candidateName: 'Jane',
      candidateEmail: 'jane@example.com',
      onAudio,
    }));
    const oldSocket = mockWsInstances[0];
    act(() => oldSocket.triggerOpen());
    act(() => result.current.reconnect());
    const newSocket = mockWsInstances[1];
    act(() => newSocket.triggerOpen());
    act(() => {
      oldSocket.triggerMessage({ type: 'audio', turn_index: 1, data: 'STALE', format: 'audio/mp3', is_final_chunk: true });
      newSocket.triggerMessage({ type: 'audio', turn_index: 1, data: 'CURRENT', format: 'audio/mp3', is_final_chunk: true });
      oldSocket.triggerError(new Event('error'));
      oldSocket.triggerClose(1006, 'Delayed old close');
      oldSocket.triggerOpen();
    });
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio).toHaveBeenCalledWith(expect.objectContaining({ data: 'CURRENT' }));
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionError).toBeNull();
    act(() => vi.advanceTimersByTime(1100));
    expect(mockWsInstances).toHaveLength(2);
  });

  it('logs WebSocket metadata without candidate text, token URL, or audio bytes', () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { result } = renderHook(() => useInterviewWebSocket({
      token: 'private-invitation-token', candidateName: 'Private Name', candidateEmail: 'private@example.test',
    }));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'Secret topic', text: 'Secret question?', is_follow_up: false, connection_id: '82e77054-e920-4deb-bfe5-1dbb7244cbac' });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'PRIVATE_AUDIO_BASE64', format: 'audio/mp3', is_final_chunk: true, connection_id: '82e77054-e920-4deb-bfe5-1dbb7244cbac' });
      result.current.sendTranscriptUpdate('Secret candidate response', true);
    });
    const output = [...info.mock.calls, ...debug.mock.calls].map((call) => String(call[0])).join('\n');
    expect(output).toContain('"connection_id":"82e77054-e920-4deb-bfe5-1dbb7244cbac"');
    for (const secret of ['private-invitation-token', 'Private Name', 'private@example.test', 'Secret topic', 'Secret question?', 'PRIVATE_AUDIO_BASE64', 'Secret candidate response']) {
      expect(output).not.toContain(secret);
    }
    vi.unstubAllEnvs();
  });
});
