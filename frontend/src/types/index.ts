export type InterviewStatus = 'pending' | 'in_progress' | 'completed' | 'expired';

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'completed';

export interface SessionMetadata {
  id: string;
  token: string;
  job_title: string;
  candidate_name?: string | null;
  candidate_email?: string | null;
  status: InterviewStatus;
  question_count: number;
  difficulty: string;
  duration_minutes: number;
  created_at: string;
  completed_at?: string | null;
  overall_score?: number | null;
  recommendation?: string | null;
  invite_url?: string;
  has_resume?: boolean;
}

export interface CreateSessionPayload {
  job_title: string;
  jd_text: string;
  question_count: number;
  difficulty: string;
  duration_minutes: number;
  candidate_name?: string;
  candidate_email?: string;
}

export interface ResumeUploadResponse {
  session_id: string;
  filename: string;
  parsed_character_count: number;
  extracted_preview: string;
}

export interface DimensionScores {
  relevance: number;
  depth: number;
  correctness: number;
  communication: number;
}

export interface EvaluationTurnItem {
  turn_index: number;
  topic?: string | null;
  question: string;
  answer: string;
  is_follow_up?: boolean;
  scores: DimensionScores;
  feedback: string;
}

export interface ScorecardResponse {
  session_id: string;
  candidate_name?: string | null;
  job_title: string;
  status: string;
  duration_seconds: number;
  overall_score: number;
  recommendation: 'Strong Hire' | 'Hire' | 'Borderline' | 'Do Not Hire' | string;
  dimension_scores: DimensionScores;
  summary: string;
  strengths: string[];
  growth_areas: string[];
  evaluations: EvaluationTurnItem[];
}

export interface TranscriptTurnItem {
  turn_index: number;
  speaker: 'interviewer' | 'candidate';
  text: string;
  timestamp: string;
}

export interface TranscriptResponse {
  session_id: string;
  turns: TranscriptTurnItem[];
}

export interface SessionListResponse {
  items: SessionMetadata[];
  total: number;
}

export interface ChatMessage {
  id: string;
  turn_index: number;
  speaker: 'interviewer' | 'candidate' | 'system';
  text: string;
  timestamp: string;
  is_final?: boolean;
  topic?: string;
}

export interface SilenceInfo {
  active: boolean;
  silenceSeconds: number;
  thresholdSeconds: number;
}

// WebSocket message protocols matching CONTRACT.md
export type WSIncomingMessage =
  | {
      type: 'status';
      state: AgentState;
      question_index: number;
      total_questions: number;
      time_elapsed_seconds: number;
    }
  | {
      type: 'question';
      turn_index: number;
      topic: string;
      text: string;
      is_follow_up: boolean;
    }
  | {
      type: 'audio';
      turn_index: number;
      data: string;
      format: string;
      is_final_chunk: boolean;
    }
  | {
      type: 'transcript';
      speaker: 'candidate';
      text: string;
      is_final: boolean;
    }
  | {
      type: 'silence_tick';
      silence_seconds: number;
      threshold_seconds: number;
    }
  | {
      type: 'interview_complete';
      session_id: string;
      closing_message: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    }
  | {
      type: 'pong';
    };

export type WSOutgoingMessage =
  | {
      type: 'start';
      candidate_name: string;
      candidate_email: string;
    }
  | {
      type: 'audio_chunk';
      data: string;
      format: string;
    }
  | {
      type: 'done_answering';
    }
  | {
      type: 'text_fallback';
      text: string;
    }
  | {
      type: 'mute_toggle';
      muted: boolean;
    }
  | {
      type: 'transcript_update';
      text: string;
      is_final: boolean;
    }
  | {
      type: 'ping';
    };
