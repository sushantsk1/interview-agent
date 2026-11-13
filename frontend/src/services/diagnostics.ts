/** Metadata-only browser diagnostics. Never pass transcript text, URLs, keys or raw errors. */
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticEvent =
  | 'http_start' | 'http_complete' | 'http_error'
  | 'ws_connect' | 'ws_open' | 'ws_close' | 'ws_reconnect' | 'ws_send' | 'ws_receive' | 'ws_error' | 'ws_parse_error'
  | 'question_pending' | 'question_revealed' | 'question_retry' | 'question_read_fallback' | 'question_stale_audio'
  | 'audio_queued' | 'audio_play_attempt' | 'audio_play_start' | 'audio_play_end' | 'audio_play_blocked' | 'audio_play_failed' | 'audio_retry' | 'audio_stop'
  | 'media_permission_request' | 'media_permission_granted' | 'media_permission_failed' | 'media_meter_failed'
  | 'media_recorder_start' | 'media_recorder_stop' | 'media_recorder_failed' | 'media_chunk_batch'
  | 'speech_recognition_failed' | 'media_muted' | 'media_video_toggled';

export type DiagnosticFields = {
  connection_id?: string;
  request_id?: string;
  turn_index?: number;
  elapsed_ms?: number;
  byte_count?: number;
  chunk_count?: number;
  queue_length?: number;
  status?: number;
  attempt?: number;
  close_code?: number;
  muted?: boolean;
  video_off?: boolean;
  operation?: 'session_lookup' | 'session_list' | 'session_create' | 'resume_upload' | 'scorecard_lookup' | 'transcript_lookup';
  message_type?: string;
  state?: string;
  error_code?: string;
  outcome?: 'success' | 'failure' | 'blocked' | 'retry';
};

const levels = { debug: 10, info: 20, warn: 30, error: 40, off: 100 } as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messageTypes = new Set(['start', 'audio_chunk', 'done_answering', 'text_fallback', 'mute_toggle', 'transcript_update', 'ping', 'replay_question', 'status', 'question', 'audio', 'transcript', 'silence_tick', 'interview_complete', 'error', 'pong']);
const states = new Set(['idle', 'thinking', 'speaking', 'listening', 'completed', 'connecting', 'disconnected']);
const operations = new Set(['session_lookup', 'session_list', 'session_create', 'resume_upload', 'scorecard_lookup', 'transcript_lookup']);
const outcomes = new Set(['success', 'failure', 'blocked', 'retry']);

function configuredLevel(): keyof typeof levels {
  const raw = String(import.meta.env.VITE_LOG_LEVEL || (import.meta.env.MODE === 'test' ? 'off' : 'info')).toLowerCase();
  return raw in levels ? raw as keyof typeof levels : 'info';
}

function safeFields(fields: DiagnosticFields): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const key of ['connection_id', 'request_id'] as const) {
    const value = fields[key];
    if (typeof value === 'string' && uuidPattern.test(value)) safe[key] = value;
  }
  for (const key of ['turn_index', 'elapsed_ms', 'byte_count', 'chunk_count', 'queue_length', 'status', 'attempt', 'close_code'] as const) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12) safe[key] = Math.round(value);
  }
  if (typeof fields.muted === 'boolean') safe.muted = fields.muted;
  if (typeof fields.video_off === 'boolean') safe.video_off = fields.video_off;
  if (fields.operation && operations.has(fields.operation)) safe.operation = fields.operation;
  if (fields.message_type && messageTypes.has(fields.message_type)) safe.message_type = fields.message_type;
  if (fields.state && states.has(fields.state)) safe.state = fields.state;
  if (fields.outcome && outcomes.has(fields.outcome)) safe.outcome = fields.outcome;
  if (fields.error_code && /^[A-Z][A-Z0-9_]{1,39}$/.test(fields.error_code)) safe.error_code = fields.error_code;
  return safe;
}

export function logDiagnostic(level: DiagnosticLevel, event: DiagnosticEvent, fields: DiagnosticFields = {}): void {
  if (levels[level] < levels[configuredLevel()]) return;
  const record = { scope: 'interview_agent_frontend', time: new Date().toISOString(), level, event, ...safeFields(fields) };
  console[level](JSON.stringify(record));
}

export function diagnosticNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
