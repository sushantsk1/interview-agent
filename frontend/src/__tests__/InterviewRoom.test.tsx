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

  class MockWebSocket {
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
    originalWebSocket = window.WebSocket;
    (window as any).WebSocket = MockWebSocket;
    vi.spyOn(api, 'fetchSessionByToken').mockResolvedValue(mockSession);
  });

  afterEach(() => {
    (window as any).WebSocket = originalWebSocket;
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

    expect(screen.getByText('How do you handle idempotent API requests?')).toBeInTheDocument();
    expect(screen.getByText('Distributed Systems')).toBeInTheDocument();
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
    });

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
    });

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
