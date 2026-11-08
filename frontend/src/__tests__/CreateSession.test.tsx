import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CreateSession } from '../pages/CreateSession';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  createSession: vi.fn(),
  uploadResume: vi.fn(),
}));

describe('CreateSession Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all required form controls and defaults', () => {
    render(
      <BrowserRouter>
        <CreateSession />
      </BrowserRouter>
    );

    expect(screen.getByRole('heading', { name: 'Create Interview Session' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Job Title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Job Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target Questions/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Difficulty Level/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration Cap/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Candidate Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Candidate Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Resume upload dropzone/i)).toBeInTheDocument();
  });

  it('validates required fields on empty submit', async () => {
    render(
      <BrowserRouter>
        <CreateSession />
      </BrowserRouter>
    );

    const submitBtn = screen.getByRole('button', { name: /Create & Generate Link/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Job title is required.')).toBeInTheDocument();
      expect(screen.getByText(/Job description is required/i)).toBeInTheDocument();
    });

    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('validates file type and file size (AC-003)', async () => {
    render(
      <BrowserRouter>
        <CreateSession />
      </BrowserRouter>
    );

    const fileInput = screen.getByTestId('resume-file-input');

    // 1. Invalid file extension (.exe)
    const invalidFile = new File(['fake binary'], 'malicious.exe', { type: 'application/x-msdownload' });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unsupported file type. Please upload a PDF or DOCX file (AC-003).'
      );
    });

    // 2. File size > 10MB
    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], 'huge_resume.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('File exceeds maximum 10MB limit');
    });

    // 3. Valid file (.pdf)
    const validFile = new File(['sample resume content'], 'valid_resume.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByText('valid_resume.pdf')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove resume file/i })).toBeInTheDocument();
    });

    // Test removing the file
    const removeBtn = screen.getByRole('button', { name: /Remove resume file/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText('valid_resume.pdf')).not.toBeInTheDocument();
  });

  it('submits valid session with resume and shows success dialog (AC-001, AC-002)', async () => {
    const mockCreatedSession = {
      id: 'sess-999',
      token: 'token-abc-123',
      job_title: 'Full Stack Engineer',
      status: 'pending' as const,
      question_count: 8,
      difficulty: 'Mid-level',
      duration_minutes: 30,
      candidate_name: 'Jordan Lee',
      candidate_email: 'jordan@example.com',
      created_at: '2026-11-07T12:00:00Z',
    };

    vi.mocked(api.createSession).mockResolvedValue(mockCreatedSession);
    vi.mocked(api.uploadResume).mockResolvedValue({
      session_id: 'sess-999',
      filename: 'jordan_resume.pdf',
      parsed_character_count: 3500,
      extracted_preview: 'Jordan Lee - Senior Developer...',
    });

    render(
      <BrowserRouter>
        <CreateSession />
      </BrowserRouter>
    );

    // Fill form
    fireEvent.change(screen.getByLabelText(/Job Title/i), {
      target: { value: 'Full Stack Engineer' },
    });
    fireEvent.change(screen.getByLabelText(/Job Description/i), {
      target: {
        value: 'We need an experienced Full Stack Engineer with proficiency in React and Node.js.',
      },
    });
    fireEvent.change(screen.getByLabelText(/Candidate Name/i), {
      target: { value: 'Jordan Lee' },
    });
    fireEvent.change(screen.getByLabelText(/Candidate Email/i), {
      target: { value: 'jordan@example.com' },
    });

    // Attach resume
    const validFile = new File(['jordan resume content'], 'jordan_resume.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(screen.getByTestId('resume-file-input'), {
      target: { files: [validFile] },
    });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Create & Generate Link/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createSession).toHaveBeenCalledWith({
        job_title: 'Full Stack Engineer',
        jd_text: 'We need an experienced Full Stack Engineer with proficiency in React and Node.js.',
        question_count: 8,
        difficulty: 'Mid-level',
        duration_minutes: 30,
        candidate_name: 'Jordan Lee',
        candidate_email: 'jordan@example.com',
      });
      expect(api.uploadResume).toHaveBeenCalledWith('sess-999', validFile);
    });

    // Verify success modal opens with link and buttons
    await waitFor(() => {
      expect(screen.getByText('Interview Session Created!')).toBeInTheDocument();
      expect(screen.getByDisplayValue(/\/interview\/token-abc-123/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy invitation link/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go to Dashboard/i })).toBeInTheDocument();
    });
  });
});
