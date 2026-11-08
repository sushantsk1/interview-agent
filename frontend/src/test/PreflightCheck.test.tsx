import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreflightCheck } from '../pages/PreflightCheck';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  fetchSessionByToken: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getWebSocketUrl: vi.fn(() => 'ws://localhost:8000/ws/interview/test-token'),
}));

describe('PreflightCheck Page (AC-004, AC-005, AC-006, AC-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders invalid link error state when token not found (AC-004)', async () => {
    vi.mocked(api.fetchSessionByToken).mockRejectedValueOnce(
      new (api.ApiError as any)(404, 'Session not found')
    );

    render(
      <MemoryRouter initialEntries={['/interview/invalid-token']}>
        <Routes>
          <Route path="/interview/:token" element={<PreflightCheck />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Invalid or Expired Link')).toBeInTheDocument();
    });
  });

  it('renders session info and pre-fills candidate details (AC-004, AC-005)', async () => {
    vi.mocked(api.fetchSessionByToken).mockResolvedValueOnce({
      id: 'session-123',
      token: 'valid-token',
      job_title: 'Senior Python Engineer',
      candidate_name: 'Alex Smith',
      candidate_email: 'alex@example.com',
      status: 'pending',
      question_count: 8,
      difficulty: 'Senior',
      duration_minutes: 30,
      created_at: new Date().toISOString(),
    });

    render(
      <MemoryRouter initialEntries={['/interview/valid-token']}>
        <Routes>
          <Route path="/interview/:token" element={<PreflightCheck />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Alex Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('alex@example.com')).toBeInTheDocument();
    });
  });

  it('validates candidate email format and name (AC-005)', async () => {
    vi.mocked(api.fetchSessionByToken).mockResolvedValueOnce({
      id: 'session-123',
      token: 'valid-token',
      job_title: 'Software Engineer',
      candidate_name: '',
      candidate_email: '',
      status: 'pending',
      question_count: 5,
      difficulty: 'Mid-level',
      duration_minutes: 30,
      created_at: new Date().toISOString(),
    });

    render(
      <MemoryRouter initialEntries={['/interview/valid-token']}>
        <Routes>
          <Route path="/interview/:token" element={<PreflightCheck />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);

    // Fill invalid email and trigger blur
    fireEvent.change(nameInput, { target: { value: 'A' } });
    fireEvent.blur(nameInput);
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.blur(emailInput);

    expect(screen.getByText(/Please enter your full name \(at least 2 characters\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Please enter a valid email address/i)).toBeInTheDocument();
  });
});