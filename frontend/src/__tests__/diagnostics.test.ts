import { afterEach, describe, expect, it, vi } from 'vitest';
import { logDiagnostic } from '../services/diagnostics';
import { fetchSessionByToken } from '../services/api';

const requestId = '82e77054-e920-4deb-bfe5-1dbb7244cbac';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('privacy-safe browser diagnostics', () => {
  it('keeps only allowlisted metadata in structured console output', () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logDiagnostic('info', 'question_revealed', {
      connection_id: requestId,
      turn_index: 2,
      elapsed_ms: 123.6,
      error_code: 'TTS_FAILED',
      token: 'private-invitation-token',
      text: 'candidate secret answer',
      url: 'https://example.test/interview/private-invitation-token',
    } as never);
    const output = String(info.mock.calls[0][0]);
    const record = JSON.parse(output);
    expect(record).toMatchObject({
      scope: 'interview_agent_frontend', event: 'question_revealed',
      connection_id: requestId, turn_index: 2, elapsed_ms: 124, error_code: 'TTS_FAILED',
    });
    expect(output).not.toContain('private-invitation-token');
    expect(output).not.toContain('candidate secret answer');
    expect(output).not.toContain('https://');
  });

  it('logs request timing and request ID without the token URL or response body', async () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'info');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => requestId },
      json: async () => ({ token: 'private-invitation-token', candidate_email: 'private@example.test' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchSessionByToken('private-invitation-token');
    const output = info.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('"request_id":"' + requestId + '"');
    expect(output).toContain('"operation":"session_lookup"');
    expect(output).not.toContain('private-invitation-token');
    expect(output).not.toContain('private@example.test');
    expect(output).not.toContain('by-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can be silenced by VITE_LOG_LEVEL', () => {
    vi.stubEnv('VITE_LOG_LEVEL', 'off');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logDiagnostic('info', 'ws_open');
    expect(info).not.toHaveBeenCalled();
  });
});
