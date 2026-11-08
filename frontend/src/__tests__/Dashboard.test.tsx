import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from '../pages/Dashboard';
import * as api from '../services/api';
import type { SessionMetadata } from '../types';

vi.mock('../services/api', () => ({
  fetchSessions: vi.fn(),
}));

const mockSessions: SessionMetadata[] = [
  {
    id: 'sess-1',
    token: 'tok-111',
    job_title: 'Senior Python Engineer',
    candidate_name: 'Alice Johnson',
    candidate_email: 'alice@example.com',
    status: 'completed',
    question_count: 8,
    difficulty: 'Senior',
    duration_minutes: 30,
    overall_score: 8.5,
    recommendation: 'Hire',
    created_at: '2026-11-07T12:00:00Z',
    has_resume: true,
  },
  {
    id: 'sess-2',
    token: 'tok-222',
    job_title: 'Frontend React Developer',
    candidate_name: 'Bob Smith',
    candidate_email: 'bob@example.com',
    status: 'pending',
    question_count: 6,
    difficulty: 'Mid-level',
    duration_minutes: 30,
    created_at: '2026-11-07T13:00:00Z',
    has_resume: false,
  },
  {
    id: 'sess-3',
    token: 'tok-333',
    job_title: 'DevOps Engineer',
    candidate_name: null,
    candidate_email: null,
    status: 'in_progress',
    question_count: 10,
    difficulty: 'Senior',
    duration_minutes: 45,
    created_at: '2026-11-07T14:00:00Z',
    has_resume: false,
  },
];

describe('Dashboard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dashboard with session list and statistics correctly', async () => {
    vi.mocked(api.fetchSessions).mockResolvedValue({
      items: mockSessions,
      total: 3,
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    // Header & Titles
    expect(screen.getByText('AI Interview Agent')).toBeInTheDocument();
    expect(screen.getByText('Create New Interview')).toBeInTheDocument();

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
      expect(screen.getByText('Frontend React Developer')).toBeInTheDocument();
      expect(screen.getByText('DevOps Engineer')).toBeInTheDocument();
    });

    // Verify stats
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('Unassigned Candidate')).toBeInTheDocument();

    // Verify score badge for completed session
    expect(screen.getByText('8.5')).toBeInTheDocument();
    expect(screen.getByText('Hire')).toBeInTheDocument();
  });

  it('filters sessions using status filter tabs', async () => {
    vi.mocked(api.fetchSessions).mockResolvedValue({
      items: mockSessions,
      total: 3,
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    });

    // Click Pending filter tab
    const pendingTab = screen.getByRole('button', { name: /Pending/i });
    fireEvent.click(pendingTab);

    expect(screen.getByText('Frontend React Developer')).toBeInTheDocument();
    expect(screen.queryByText('Senior Python Engineer')).not.toBeInTheDocument();
    expect(screen.queryByText('DevOps Engineer')).not.toBeInTheDocument();

    // Click Completed filter tab
    const completedTab = screen.getByRole('button', { name: /Completed/i });
    fireEvent.click(completedTab);

    expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Frontend React Developer')).not.toBeInTheDocument();
  });

  it('filters sessions based on search input', async () => {
    vi.mocked(api.fetchSessions).mockResolvedValue({
      items: mockSessions,
      total: 3,
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search by role or candidate...');
    fireEvent.change(searchInput, { target: { value: 'react' } });

    expect(screen.getByText('Frontend React Developer')).toBeInTheDocument();
    expect(screen.queryByText('Senior Python Engineer')).not.toBeInTheDocument();
    expect(screen.queryByText('DevOps Engineer')).not.toBeInTheDocument();
  });

  it('handles empty state when no sessions are found', async () => {
    vi.mocked(api.fetchSessions).mockResolvedValue({
      items: [],
      total: 0,
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No Interview Sessions Yet')).toBeInTheDocument();
      expect(screen.getByText('Create Your First Interview')).toBeInTheDocument();
    });
  });

  it('handles copy candidate link button click', async () => {
    vi.mocked(api.fetchSessions).mockResolvedValue({
      items: [mockSessions[0]],
      total: 1,
    });

    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole('button', { name: /Copy Link/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/interview/tok-111'));
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('renders error state on API failure and supports retry', async () => {
    vi.mocked(api.fetchSessions).mockRejectedValueOnce(new Error('Network error'));

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to load interview sessions')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Click retry
    vi.mocked(api.fetchSessions).mockResolvedValueOnce({
      items: mockSessions,
      total: 3,
    });

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Senior Python Engineer')).toBeInTheDocument();
    });
  });
});
