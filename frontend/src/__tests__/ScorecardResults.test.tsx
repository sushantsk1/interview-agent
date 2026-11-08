import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ScorecardResults } from '../pages/ScorecardResults';
import * as api from '../services/api';
import type { ScorecardResponse, TranscriptResponse } from '../types';

vi.mock('../services/api', () => ({
  fetchScorecard: vi.fn(),
  fetchTranscript: vi.fn(),
}));

const mockScorecard: ScorecardResponse = {
  session_id: 'sess-100',
  candidate_name: 'Elena Rostova',
  job_title: 'Staff Software Architect',
  status: 'completed',
  duration_seconds: 1420, // 23m 40s
  overall_score: 9.1,
  recommendation: 'Strong Hire',
  dimension_scores: {
    relevance: 9.4,
    depth: 9.0,
    correctness: 9.2,
    communication: 8.8,
  },
  summary:
    'Elena demonstrated exceptional architectural vision, clearly articulating trade-offs between eventual consistency and strict ACID transactional models.',
  strengths: [
    'Deep mastery of distributed messaging systems and backpressure patterns',
    'Exemplary communication with structured, concise technical explanations',
  ],
  growth_areas: [
    'Could provide more specific production telemetry metrics regarding distributed tracing',
  ],
  evaluations: [
    {
      turn_index: 1,
      topic: 'Distributed Systems & Consistency',
      question: 'How do you design for partition tolerance in a globally distributed multi-region database?',
      answer: 'We leverage consensus algorithms like Raft for leader election and vector clocks for conflict resolution...',
      is_follow_up: false,
      scores: {
        relevance: 9.5,
        depth: 9.2,
        correctness: 9.4,
        communication: 9.0,
      },
      feedback: 'Outstanding explanation covering quorum reads and network latency trade-offs.',
    },
    {
      turn_index: 2,
      topic: 'Distributed Systems & Consistency',
      question: 'Can you elaborate on how vector clocks handle concurrent writes?',
      answer: 'Vector clocks track causality across distributed nodes via monotonically increasing logical counters...',
      is_follow_up: true,
      scores: {
        relevance: 9.3,
        depth: 8.8,
        correctness: 9.0,
        communication: 8.6,
      },
      feedback: 'Solid follow-up response clarifying causal ordering vs total ordering.',
    },
  ],
};

const mockTranscript: TranscriptResponse = {
  session_id: 'sess-100',
  turns: [
    {
      turn_index: 1,
      speaker: 'interviewer',
      text: 'How do you design for partition tolerance in a globally distributed multi-region database?',
      timestamp: '2026-11-07T12:01:00Z',
    },
    {
      turn_index: 1,
      speaker: 'candidate',
      text: 'We leverage consensus algorithms like Raft for leader election and vector clocks for conflict resolution...',
      timestamp: '2026-11-07T12:02:15Z',
    },
  ],
};

describe('ScorecardResults Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders complete scorecard hero, 4D scores, summary, and evaluations', async () => {
    vi.mocked(api.fetchScorecard).mockResolvedValue(mockScorecard);
    vi.mocked(api.fetchTranscript).mockResolvedValue(mockTranscript);

    render(
      <MemoryRouter initialEntries={['/results/sess-100']}>
        <Routes>
          <Route path="/results/:sessionId" element={<ScorecardResults />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Elena Rostova')).toBeInTheDocument();
      expect(screen.getByText('Staff Software Architect')).toBeInTheDocument();
      expect(screen.getByText(/Duration: 23m 40s/i)).toBeInTheDocument();
    });

    // Score & Recommendation
    expect(screen.getByTestId('overall-score')).toHaveTextContent('9.1');
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent('Strong Hire');

    // 4-Dimension Scores
    expect(screen.getByTestId('dimension-relevance')).toHaveTextContent('9.4');
    expect(screen.getByTestId('dimension-depth')).toHaveTextContent('9.0');
    expect(screen.getByTestId('dimension-correctness')).toHaveTextContent('9.2');
    expect(screen.getByTestId('dimension-communication')).toHaveTextContent('8.8');

    // Executive Summary
    expect(screen.getByTestId('executive-summary')).toHaveTextContent(
      'Elena demonstrated exceptional architectural vision'
    );

    // Strengths & Growth Areas
    expect(screen.getByTestId('strengths-list')).toHaveTextContent(
      'Deep mastery of distributed messaging systems'
    );
    expect(screen.getByTestId('growth-areas-list')).toHaveTextContent(
      'Could provide more specific production telemetry metrics'
    );

    // Turn 1 Deep Dive
    expect(screen.getByText('Turn 1')).toBeInTheDocument();
    expect(screen.getAllByText('Distributed Systems & Consistency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Primary Question')).toBeInTheDocument();
    expect(screen.getByText(/Outstanding explanation covering quorum reads/i)).toBeInTheDocument();

    // Turn 2 Follow-Up
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('Follow-Up Question')).toBeInTheDocument();
  });

  it('switches to verbatim chronological transcript tab (AC-029)', async () => {
    vi.mocked(api.fetchScorecard).mockResolvedValue(mockScorecard);
    vi.mocked(api.fetchTranscript).mockResolvedValue(mockTranscript);

    render(
      <MemoryRouter initialEntries={['/results/sess-100']}>
        <Routes>
          <Route path="/results/:sessionId" element={<ScorecardResults />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Elena Rostova')).toBeInTheDocument();
    });

    const transcriptTab = screen.getByRole('button', { name: /Verbatim Chronological Transcript/i });
    fireEvent.click(transcriptTab);

    await waitFor(() => {
      expect(screen.getByTestId('transcript-section')).toBeInTheDocument();
      expect(screen.getByText('AI Interviewer')).toBeInTheDocument();
      expect(screen.getByText('Candidate')).toBeInTheDocument();
    });
  });

  it('renders graceful error message when scorecard is not found', async () => {
    vi.mocked(api.fetchScorecard).mockRejectedValue(new Error('Scorecard not found'));
    vi.mocked(api.fetchTranscript).mockResolvedValue({ session_id: 'sess-100', turns: [] });

    render(
      <MemoryRouter initialEntries={['/results/sess-100']}>
        <Routes>
          <Route path="/results/:sessionId" element={<ScorecardResults />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Scorecard Not Available')).toBeInTheDocument();
      expect(screen.getByText('Scorecard not found')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });
});
