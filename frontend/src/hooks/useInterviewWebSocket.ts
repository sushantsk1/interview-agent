import { useState, useEffect, useRef, useCallback } from 'react';
import type { WSIncomingMessage, WSOutgoingMessage } from '../types';
import { getWebSocketUrl } from '../services/api';

export interface UseInterviewWebSocketOptions {
  token: string | undefined;
  candidateName: string;
  candidateEmail: string;
  enabled?: boolean;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  onStatus?: (msg: Extract<WSIncomingMessage, { type: 'status' }>) => void;
  onQuestion?: (msg: Extract<WSIncomingMessage, { type: 'question' }>) => void;
  onAudio?: (msg: Extract<WSIncomingMessage, { type: 'audio' }>) => void;
  onTranscript?: (msg: Extract<WSIncomingMessage, { type: 'transcript' }>) => void;
  onSilenceTick?: (msg: Extract<WSIncomingMessage, { type: 'silence_tick' }>) => void;
  onInterviewComplete?: (msg: Extract<WSIncomingMessage, { type: 'interview_complete' }>) => void;
  onError?: (msg: Extract<WSIncomingMessage, { type: 'error' }> | Event) => void;
  onPong?: () => void;
}

export interface UseInterviewWebSocketReturn {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  reconnectAttempts: number;
  sendOutgoingMessage: (payload: WSOutgoingMessage) => boolean;
  sendAudioChunk: (data: string, format?: string) => boolean;
  sendTranscriptUpdate: (text: string, isFinal: boolean) => boolean;
  sendDoneAnswering: () => boolean;
  sendTextFallback: (text: string) => boolean;
  sendMuteToggle: (muted: boolean) => boolean;
  reconnect: () => void;
  disconnect: () => void;
}

/**
 * WebSocket interaction hook adhering to CONTRACT.md Section 3.
 * Manages full-duplex streaming with the backend voice pipeline:
 * - Handshake on open (`start`)
 * - Continuous 20s heartbeat (`ping`/`pong`)
 * - Chunk transmission (`audio_chunk`)
 * - Manual turn completion (`done_answering`)
 * - Text fallback submission (`text_fallback`)
 * - Mute toggles (`mute_toggle`)
 * - Reconnection and retry logic (AC-026)
 */
export function useInterviewWebSocket({
  token,
  candidateName,
  candidateEmail,
  enabled = true,
  autoReconnect = true,
  maxReconnectAttempts = 5,
  onStatus,
  onQuestion,
  onAudio,
  onTranscript,
  onSilenceTick,
  onInterviewComplete,
  onError,
  onPong,
}: UseInterviewWebSocketOptions): UseInterviewWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const isUnmountedRef = useRef(false);

  const candidateNameRef = useRef(candidateName);
  const candidateEmailRef = useRef(candidateEmail);

  useEffect(() => {
    candidateNameRef.current = candidateName;
    candidateEmailRef.current = candidateEmail;
  }, [candidateName, candidateEmail]);

  // Callbacks refs
  const onStatusRef = useRef(onStatus);
  const onQuestionRef = useRef(onQuestion);
  const onAudioRef = useRef(onAudio);
  const onTranscriptRef = useRef(onTranscript);
  const onSilenceTickRef = useRef(onSilenceTick);
  const onInterviewCompleteRef = useRef(onInterviewComplete);
  const onErrorRef = useRef(onError);
  const onPongRef = useRef(onPong);

  useEffect(() => {
    onStatusRef.current = onStatus;
    onQuestionRef.current = onQuestion;
    onAudioRef.current = onAudio;
    onTranscriptRef.current = onTranscript;
    onSilenceTickRef.current = onSilenceTick;
    onInterviewCompleteRef.current = onInterviewComplete;
    onErrorRef.current = onError;
    onPongRef.current = onPong;
  });

  const clearHeartbeat = () => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const sendOutgoingMessage = useCallback((payload: WSOutgoingMessage): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        console.warn('Failed to send WebSocket message:', err);
        return false;
      }
    }
    return false;
  }, []);

  const sendAudioChunk = useCallback(
    (data: string, format = 'audio/webm;codecs=opus'): boolean => {
      return sendOutgoingMessage({
        type: 'audio_chunk',
        data,
        format,
      });
    },
    [sendOutgoingMessage]
  );

  const sendTranscriptUpdate = useCallback(
    (text: string, isFinal: boolean): boolean => {
      return sendOutgoingMessage({
        type: 'transcript_update',
        text,
        is_final: isFinal,
      });
    },
    [sendOutgoingMessage]
  );

  const sendDoneAnswering = useCallback((): boolean => {
    return sendOutgoingMessage({ type: 'done_answering' });
  }, [sendOutgoingMessage]);

  const sendTextFallback = useCallback(
    (text: string): boolean => {
      return sendOutgoingMessage({
        type: 'text_fallback',
        text,
      });
    },
    [sendOutgoingMessage]
  );

  const sendMuteToggle = useCallback(
    (muted: boolean): boolean => {
      return sendOutgoingMessage({
        type: 'mute_toggle',
        muted,
      });
    },
    [sendOutgoingMessage]
  );

  const connect = useCallback(() => {
    if (!token || !enabled || isUnmountedRef.current) return;

    // Close any previous socket cleanly
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    clearHeartbeat();
    clearReconnectTimer();

    setIsConnecting(true);
    const wsUrl = getWebSocketUrl(token);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current || wsRef.current !== ws) return;
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        setReconnectAttempts(0);

        // Send start handshake (CONTRACT.md Section 3.1)
        sendOutgoingMessage({
          type: 'start',
          candidate_name: candidateNameRef.current || 'Candidate',
          candidate_email: candidateEmailRef.current || '',
        });

        // Start 20-second heartbeat ping as defined in CONTRACT.md
        clearHeartbeat();
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (isUnmountedRef.current || wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data) as WSIncomingMessage;
          switch (msg.type) {
            case 'status':
              onStatusRef.current?.(msg);
              break;
            case 'question':
              onQuestionRef.current?.(msg);
              break;
            case 'audio':
              onAudioRef.current?.(msg);
              break;
            case 'transcript':
              onTranscriptRef.current?.(msg);
              break;
            case 'silence_tick':
              onSilenceTickRef.current?.(msg);
              break;
            case 'interview_complete':
              onInterviewCompleteRef.current?.(msg);
              break;
            case 'error':
              setConnectionError(msg.message || 'Server error occurred');
              onErrorRef.current?.(msg);
              break;
            case 'pong':
              onPongRef.current?.();
              break;
          }
        } catch (err) {
          console.warn('Failed to parse incoming WebSocket message:', err);
        }
      };

      ws.onerror = (evt: Event) => {
        if (isUnmountedRef.current || wsRef.current !== ws) return;
        console.warn('WebSocket connection error:', evt);
        setConnectionError('Connection interrupted. Unable to reach interview server.');
        onErrorRef.current?.(evt);
      };

      ws.onclose = (evt: CloseEvent) => {
        if (isUnmountedRef.current || wsRef.current !== ws) return;
        setIsConnected(false);
        setIsConnecting(false);
        clearHeartbeat();

        // Normal close (e.g. 1000) does not trigger auto-reconnect
        if (evt.code !== 1000 && autoReconnect) {
          setReconnectAttempts((prev) => {
            const next = prev + 1;
            if (next <= maxReconnectAttempts) {
              const backoffMs = Math.min(1000 * Math.pow(2, next - 1), 8000);
              setConnectionError(`Connection lost. Retrying in ${(backoffMs / 1000).toFixed(0)}s (attempt ${next}/${maxReconnectAttempts})...`);
              reconnectTimerRef.current = setTimeout(() => {
                connectRef.current();
              }, backoffMs);
            } else {
              setConnectionError('Connection disconnected. Please check your network and click "Retry Connection".');
            }
            return next;
          });
        }
      };
    } catch (err) {
      console.warn('Error opening WebSocket:', err);
      setIsConnecting(false);
      setConnectionError('Failed to initiate WebSocket connection.');
    }
  }, [
    token,
    enabled,
    autoReconnect,
    maxReconnectAttempts,
    sendOutgoingMessage,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    clearHeartbeat();
    clearReconnectTimer();
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Client disconnected');
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    setConnectionError(null);
    connect();
  }, [connect]);

  useEffect(() => {
    isUnmountedRef.current = false;
    if (enabled && token) {
      connect();
    }

    return () => {
      isUnmountedRef.current = true;
      disconnect();
    };
  }, [enabled, token, disconnect]);

  return {
    isConnected,
    isConnecting,
    connectionError,
    reconnectAttempts,
    sendOutgoingMessage,
    sendAudioChunk,
    sendTranscriptUpdate,
    sendDoneAnswering,
    sendTextFallback,
    sendMuteToggle,
    reconnect,
    disconnect,
  };
}
