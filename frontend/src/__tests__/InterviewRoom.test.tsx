import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InterviewRoom } from '../pages/InterviewRoom';
import * as api from '../services/api';

// Mock media stream hook
const mockToggleMute = vi.fn();
const mockToggleVideo = vi.fn();
const mockRequestPermissions = vi.fn();
const mockStopAllTracks = vi.fn();

vi.mock('../hooks/useMediaStream', () => ({
  useMediaStream: () => ({
    stream: {
      getAudioTracks: () => [{ kind: 'audio', enabled: true, stop: vi.fn() }],
      getVideoTracks: () => [{ kind: 'video', enabled: true, stop: vi.fn() }],
    },
    status: 'granted',
    isMuted: false,
    isVideoOff: false,
    audioLevel: 42,
    requestPermissions: mockRequestPermissions,
    toggleMute: mockToggleMute,
    toggleVideo: mockToggleVideo,
    stopAllTracks: mockStopAllTracks,
  }),
}));

describe('InterviewRoom Component (AC-008 to AC-014, AC-022, AC-026)', () => {
  let mockWsInstances: MockWebSocket[] = [];
  let originalWebSocket: typeof WebSocket;
  let originalAudio: typeof Audio;
  let mockAudioInstances: MockAudio[] = [];
  let rejectNextAudioPlay = false;
  let rejectNextAudioDecode = false;

  class MockAudio {
    src: string;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn().mockImplementation(() => {
      if (rejectNextAudioDecode) {
        rejectNextAudioDecode = false;
        return Promise.reject(new DOMException('Invalid MP3', 'NotSupportedError'));
      }
      if (rejectNextAudioPlay) {
        rejectNextAudioPlay = false;
        return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
      }
      return Promise.resolve();
    });
    pause = vi.fn();

    constructor(src: string) {
      this.src = src;
      mockAudioInstances.push(this);
    }
  }

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

    close = vi.fn((code = 1000) => {
      this.readyState = WebSocket.CLOSED;
      this.onclose?.({ code } as any);
    });

    triggerOpen() {
      this.readyState = WebSocket.OPEN;
      this.onopen?.({} as any);
    }

    triggerMessage(data: object) {
      this.onmessage?.({ data: JSON.stringify(data) } as any);
    }

    triggerClose(code = 1006) {
      this.readyState = WebSocket.CLOSED;
      this.onclose?.({ code } as any);
    }
  }

  const mockSession = {
    id: 'session-xyz-123',
    token: 'token-abc-456',
    job_title: 'Senior Python Engineer',
    candidate_name: 'Alex Rivera',
    candidate_email: 'alex@example.com',
    status: 'pending' as const,
    question_count: 5,
    difficulty: 'Senior',
    duration_minutes: 25,
    created_at: '2026-11-07T12:00:00Z',
  };

  beforeEach(() => {
    mockWsInstances = [];
    mockAudioInstances = [];
    rejectNextAudioPlay = false;
    rejectNextAudioDecode = false;
    originalWebSocket = window.WebSocket;
    originalAudio = window.Audio;
    (window as any).WebSocket = MockWebSocket;
    (window as any).Audio = MockAudio;
    vi.spyOn(api, 'fetchSessionByToken').mockResolvedValue(mockSession);
  });

  afterEach(() => {
    (window as any).WebSocket = originalWebSocket;
    (window as any).Audio = originalAudio;
    vi.clearAllMocks();
  });

  const renderRoom = () => {
    return render(
      <MemoryRouter initialEntries={['/interview/token-abc-456/room']}>
        <Routes>
          <Route path="/interview/:token/room" element={<InterviewRoom />} />
          <Route path="/results/:sessionId" element={<div data-testid="results-screen">Results Screen</div>} />
          <Route path="/" element={<div data-testid="home-screen">Home Screen</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders split-screen layout with webcam, header, avatar, and transcript (AC-008)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    });

    // Check webcam badge
    expect(screen.getByText(/Alex Rivera/i)).toBeInTheDocument();

    // Check Done Answering button (AC-013)
    expect(screen.getByText(/Done Answering/i)).toBeInTheDocument();

    // Check mute toggle button (AC-014)
    expect(screen.getByText(/Mute Mic/i)).toBeInTheDocument();
  });

  it('connects to WebSocket and receives interviewer question (AC-010)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    // Verify start payload was sent
    expect(ws.sentMessages.length).toBe(1);
    expect(JSON.parse(ws.sentMessages[0])).toEqual(
      expect.objectContaining({ type: 'start' })
    );

    // AI asks question
    act(() => {
      ws.triggerMessage({
        type: 'question',
        turn_index: 1,
        topic: 'Distributed Systems',
        text: 'How do you handle idempotent API requests?',
        is_follow_up: false,
      });
    });
    expect(screen.queryByText('How do you handle idempotent API requests?')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing question and voice');
    act(() => ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'MP3_BYTES', format: 'audio/mp3', is_final_chunk: true }));
    expect(screen.getByText('How do you handle idempotent API requests?')).toBeInTheDocument();
    expect(screen.getByText('Distributed Systems')).toBeInTheDocument();
  });

  it('plays question audio as soon as it arrives and stays speaking until playback ends', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'status', state: 'speaking', question_index: 1, total_questions: 5, time_elapsed_seconds: 0 });
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'MP3_BYTES', format: 'audio/mp3', is_final_chunk: true });
      ws.triggerMessage({ type: 'status', state: 'listening', question_index: 1, total_questions: 5, time_elapsed_seconds: 0 });
    });
    await waitFor(() => expect(mockAudioInstances[0].play).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Speaking')).toBeInTheDocument());
    expect(screen.getByText('How do you version an API?')).toBeInTheDocument();
    act(() => mockAudioInstances[0].onended?.());
    await waitFor(() => expect(screen.getByText('Listening')).toBeInTheDocument());
  });

  it('keeps failed speech pending until the candidate retries or chooses text', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'error', code: 'TTS_FAILED', message: 'Voice is temporarily unavailable.', turn_index: 1 });
    });
    expect(screen.queryByText('How do you version an API?')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Voice is temporarily unavailable.');
    expect(screen.getByText('Listening')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Question' })[0]);
    expect(ws.sentMessages.map((message) => JSON.parse(message))).toContainEqual({ type: 'replay_question' });
    act(() => ws.triggerMessage({ type: 'error', code: 'TTS_FAILED', message: 'Voice is still unavailable.', turn_index: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Read question instead' }));
    expect(screen.getByText('How do you version an API?')).toBeInTheDocument();
  });

  it('keeps the read fallback available when a voice retry cannot be sent', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Hidden question?', is_follow_up: false });
      ws.triggerMessage({ type: 'error', code: 'TTS_FAILED', message: 'Voice unavailable', turn_index: 1 });
      ws.triggerClose(1000);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Question' })[0]);
    expect(screen.getByRole('alert')).toHaveTextContent('Voice retry needs a connection');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read question instead' })).toBeEnabled();
    expect(screen.queryByText('Hidden question?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read question instead' }));
    expect(screen.getByText('Hidden question?')).toBeInTheDocument();
  });

  it('ignores audio for a prior turn while a new question waits for its own speech', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'First question?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'FIRST_MP3', format: 'audio/mp3', is_final_chunk: true });
    });
    expect(screen.getByText('First question?')).toBeInTheDocument();
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 2, topic: 'Systems', text: 'Second question?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'STALE_MP3', format: 'audio/mp3', is_final_chunk: true });
    });
    expect(screen.queryByText('Second question?')).not.toBeInTheDocument();
    expect(mockAudioInstances.length).toBe(1);
    act(() => ws.triggerMessage({ type: 'audio', turn_index: 2, data: 'SECOND_MP3', format: 'audio/mp3', is_final_chunk: true }));
    expect(screen.getByText('Second question?')).toBeInTheDocument();
    expect(mockAudioInstances.length).toBe(2);
  });

  it('publishes same-turn steering only with the new matching audio and ignores duplicates', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Original question?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'ORIGINAL_MP3', format: 'audio/mp3', is_final_chunk: true });
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Please answer the original question.', is_follow_up: false });
    });
    expect(screen.queryByText('Please answer the original question.')).not.toBeInTheDocument();
    act(() => ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'STEERING_MP3', format: 'audio/mp3', is_final_chunk: true }));
    expect(screen.getByText('Please answer the original question.')).toBeInTheDocument();
    act(() => ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Please answer the original question.', is_follow_up: false }));
    expect(screen.getAllByText('Please answer the original question.')).toHaveLength(1);
  });

  it('requests audio for a resumed question before revealing it', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'status', state: 'listening', question_index: 1, total_questions: 5, time_elapsed_seconds: 10 });
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Resumed question?', is_follow_up: false });
    });
    expect(screen.queryByText('Resumed question?')).not.toBeInTheDocument();
    expect(ws.sentMessages.map((message) => JSON.parse(message))).toContainEqual({ type: 'replay_question' });
    act(() => ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'RESUMED_MP3', format: 'audio/mp3', is_final_chunk: true }));
    expect(screen.getByText('Resumed question?')).toBeInTheDocument();
    act(() => ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Resumed question?', is_follow_up: false }));
    expect(screen.getAllByText('Resumed question?')).toHaveLength(1);
  });

  it('offers a click to resume question audio when browser autoplay is blocked', async () => {
    rejectNextAudioPlay = true;
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'MP3_BYTES', format: 'audio/mp3', is_final_chunk: true });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('browser paused interviewer audio'));
    expect(screen.getByText('How do you version an API?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Question' })[0]);
    await waitFor(() => expect(mockAudioInstances[0].play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Speaking')).toBeInTheDocument());
    expect(ws.sentMessages.map((message) => JSON.parse(message))).not.toContainEqual({ type: 'replay_question' });
  });

  it('requests fresh speech when the received MP3 cannot be decoded', async () => {
    rejectNextAudioDecode = true;
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'INVALID_MP3', format: 'audio/mp3', is_final_chunk: true });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('audio could not play'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Question' })[0]);
    expect(ws.sentMessages.map((message) => JSON.parse(message))).toContainEqual({ type: 'replay_question' });
  });

  it('completes the interview even if closing speech cannot play', async () => {
    rejectNextAudioPlay = true;
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'CLOSING_MP3', format: 'audio/mp3', is_final_chunk: true });
      ws.triggerMessage({ type: 'interview_complete', session_id: 'session-xyz-123', closing_message: 'Thanks for interviewing.' });
    });
    await waitFor(() => expect(screen.getByText(/Thank You, Alex Rivera!/)).toBeInTheDocument());
    expect(mockStopAllTracks).toHaveBeenCalled();
  });

  it('plays closing audio after the final answer before showing completion', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => ws.triggerOpen());
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'Final question?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'QUESTION_MP3', format: 'audio/mp3', is_final_chunk: true });
    });
    act(() => mockAudioInstances[0].onended?.());
    act(() => {
      ws.triggerMessage({ type: 'status', state: 'thinking', question_index: 1, total_questions: 1, time_elapsed_seconds: 20 });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'CLOSING_MP3', format: 'audio/mp3', is_final_chunk: true });
      ws.triggerMessage({ type: 'interview_complete', session_id: 'session-xyz-123', closing_message: 'Thanks for interviewing.' });
    });
    expect(mockAudioInstances[1].src).toContain('CLOSING_MP3');
    expect(screen.queryByText(/Thank You, Alex Rivera!/)).not.toBeInTheDocument();
    act(() => mockAudioInstances[1].onended?.());
    expect(screen.getByText(/Thank You, Alex Rivera!/)).toBeInTheDocument();
  });

  it('displays real-time candidate transcript and finalized speech (AC-011)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    // Live interim transcription streaming
    act(() => {
      ws.triggerMessage({
        type: 'transcript',
        speaker: 'candidate',
        text: 'I use idempotency keys in Redis...',
        is_final: false,
      });
    });

    expect(screen.getByText(/Transcribing live/i)).toBeInTheDocument();
    expect(screen.getByText('I use idempotency keys in Redis...')).toBeInTheDocument();

    // Finalized candidate utterance
    act(() => {
      ws.triggerMessage({
        type: 'transcript',
        speaker: 'candidate',
        text: 'I use idempotency keys stored in Redis with an atomic lock.',
        is_final: true,
      });
    });

    expect(
      screen.getByText('I use idempotency keys stored in Redis with an atomic lock.')
    ).toBeInTheDocument();
  });

  it('renders silence countdown warning on silence_tick (AC-012)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      ws.triggerMessage({
        type: 'silence_tick',
        silence_seconds: 2.1,
        threshold_seconds: 2.75,
      });
    });

    expect(screen.getByText(/Pause detected - finalizing answer/i)).toBeInTheDocument();
  });

  it('dispatches done_answering when candidate clicks manual completion button (AC-013)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'MP3_BYTES', format: 'audio/mp3', is_final_chunk: true });
    });
    act(() => mockAudioInstances[0].onended?.());

    const doneButton = screen.getByText(/Done Answering \/ Next/i);
    fireEvent.click(doneButton);

    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sent).toContainEqual({ type: 'done_answering' });
  });

  it('toggles microphone and dispatches mute_toggle over WebSocket (AC-014)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    const muteBtn = screen.getByText(/Mute Mic/i);
    fireEvent.click(muteBtn);

    expect(mockToggleMute).toHaveBeenCalled();
    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sent).toContainEqual({ type: 'mute_toggle', muted: true });
  });

  it('submits text fallback response when modal is used (AC-026)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'How do you version an API?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'MP3_BYTES', format: 'audio/mp3', is_final_chunk: true });
    });
    act(() => mockAudioInstances[0].onended?.());

    // Open text fallback modal
    const fallbackBtn = screen.getByText(/Text Fallback/i);
    fireEvent.click(fallbackBtn);

    expect(screen.getByText(/Text Fallback Response/i)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Type your response to the current interview question/i);
    fireEvent.change(textarea, { target: { value: 'My fallback written explanation.' } });

    const submitBtn = screen.getByText(/Submit Typed Answer/i);
    fireEvent.click(submitBtn);

    const sent = ws.sentMessages.map((m) => JSON.parse(m));
    expect(sent).toContainEqual({
      type: 'text_fallback',
      text: 'My fallback written explanation.',
    });

    // Chat should show typed answer
    expect(screen.getByText(/\[Typed\]: My fallback written explanation\./i)).toBeInTheDocument();
  });

  it('blocks answer actions while the current question remains hidden', async () => {
    renderRoom();
    await waitFor(() => expect(mockWsInstances.length).toBeGreaterThan(0));
    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
      ws.triggerMessage({ type: 'question', turn_index: 1, topic: 'APIs', text: 'First question?', is_follow_up: false });
      ws.triggerMessage({ type: 'audio', turn_index: 1, data: 'FIRST_MP3', format: 'audio/mp3', is_final_chunk: true });
    });
    act(() => mockAudioInstances[0].onended?.());
    fireEvent.click(screen.getByRole('button', { name: /Text Fallback/i }));
    expect(screen.getByText(/Text Fallback Response/i)).toBeInTheDocument();
    act(() => {
      ws.triggerMessage({ type: 'question', turn_index: 2, topic: 'Systems', text: 'Hidden second question?', is_follow_up: false });
      ws.triggerMessage({ type: 'error', code: 'TTS_FAILED', message: 'Voice unavailable', turn_index: 2 });
    });
    expect(screen.queryByText('Hidden second question?')).not.toBeInTheDocument();
    expect(screen.queryByText(/Text Fallback Response/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Text Fallback/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Done Answering/i })).toBeDisabled();
    expect(ws.sentMessages.some((message) => JSON.parse(message).type === 'text_fallback')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Read question instead' }));
    expect(screen.getByText('Hidden second question?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Text Fallback/i })).toBeEnabled();
  });

  it('transitions to completion view with "View Results" button on interview_complete (AC-022)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    act(() => {
      ws.triggerMessage({
        type: 'interview_complete',
        session_id: 'session-xyz-123',
        closing_message: 'Great job today! Your screening is concluded.',
      });
    });

    expect(screen.getByText(/Thank You, Alex Rivera!/i)).toBeInTheDocument();
    expect(screen.getByText(/Great job today!/i)).toBeInTheDocument();
    expect(screen.getByText(/View Results/i)).toBeInTheDocument();

    // Clicking View Results navigates to results
    fireEvent.click(screen.getByText(/View Results/i));
    expect(screen.getByTestId('results-screen')).toBeInTheDocument();
  });

  it('displays reconnect banner and allows manual retry on connection loss (AC-026)', async () => {
    renderRoom();

    await waitFor(() => {
      expect(mockWsInstances.length).toBeGreaterThan(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      ws.triggerOpen();
    });

    // Simulate unexpected drop
    act(() => {
      ws.triggerClose(1006);
    });

    expect(screen.getByText(/Retry Connection/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection lost/i)).toBeInTheDocument();
  });
});
