import type {
  SessionMetadata,
  SessionListResponse,
  CreateSessionPayload,
  ResumeUploadResponse,
  ScorecardResponse,
  TranscriptResponse,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: string;

  constructor(status: number, message: string, code?: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function handleResponseError(response: Response, defaultMessage: string, defaultCode = 'API_ERROR'): Promise<never> {
  let errorDetail = defaultMessage;
  let errorCode = defaultCode;
  try {
    const errJson = await response.json();
    if (errJson.detail) {
      if (typeof errJson.detail === 'object' && errJson.detail.detail) {
        errorDetail = errJson.detail.detail;
        if (errJson.detail.code) errorCode = errJson.detail.code;
      } else if (typeof errJson.detail === 'string') {
        errorDetail = errJson.detail;
      }
    }
    if (errJson.code && typeof errJson.code === 'string') {
      errorCode = errJson.code;
    }
  } catch {
    // Non-json response
  }
  throw new ApiError(response.status, errorDetail, errorCode, errorDetail);
}

export async function fetchSessionByToken(token: string): Promise<SessionMetadata> {
  const url = `${API_BASE}/sessions/by-token/${encodeURIComponent(token)}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to connect to interview server: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Session not found or expired', 'SESSION_NOT_FOUND');
  }

  return response.json();
}

export async function fetchSessions(
  statusFilter?: string,
  limit = 50,
  offset = 0
): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (statusFilter && statusFilter !== 'all') {
    params.set('status', statusFilter);
  }
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const url = `${API_BASE}/sessions?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to fetch sessions: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Failed to fetch interview sessions', 'SESSIONS_FETCH_FAILED');
  }

  return response.json();
}

export async function createSession(payload: CreateSessionPayload): Promise<SessionMetadata> {
  const url = `${API_BASE}/sessions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to create session: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Failed to create interview session', 'SESSION_CREATION_FAILED');
  }

  return response.json();
}

export async function uploadResume(
  sessionId: string,
  file: File
): Promise<ResumeUploadResponse> {
  const url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/resume`;
  const formData = new FormData();
  formData.append('file', file);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to upload resume: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Failed to upload resume file', 'RESUME_UPLOAD_FAILED');
  }

  return response.json();
}

export async function fetchScorecard(sessionId: string): Promise<ScorecardResponse> {
  const url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/scorecard`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to fetch scorecard: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Failed to fetch candidate scorecard', 'SCORECARD_FETCH_FAILED');
  }

  return response.json();
}

export async function fetchTranscript(sessionId: string): Promise<TranscriptResponse> {
  const url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/transcript`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network request failed';
    throw new ApiError(0, `Unable to fetch transcript: ${errorMsg}`);
  }

  if (!response.ok) {
    return handleResponseError(response, 'Failed to fetch interview transcript', 'TRANSCRIPT_FETCH_FAILED');
  }

  return response.json();
}

export function getWebSocketUrl(token: string): string {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const customHost = import.meta.env.VITE_WS_HOST;
  if (customHost) {
    return `${wsProtocol}//${customHost}/ws/interview/${encodeURIComponent(token)}`;
  }
  // Default to backend on 8000
  return `ws://localhost:8000/ws/interview/${encodeURIComponent(token)}`;
}
