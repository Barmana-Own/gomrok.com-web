import { useEffect, useRef } from 'react';

function parseEvents(buffer, onEvent) {
  const chunks = buffer.split('\n\n');
  const remainder = chunks.pop() || '';
  for (const chunk of chunks) {
    const eventName = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim() || '';
    const data = chunk.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (!data || eventName === 'ready') continue;
    try { onEvent(JSON.parse(data)); } catch (_error) { /* Keep the stream alive on a malformed frame. */ }
  }
  return remainder;
}

export function usePlatformRealtime({ apiUrl, token, onEvent, enabled = true }) {
  const callbackRef = useRef(onEvent);
  const refreshTimerRef = useRef(null);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !apiUrl || !token || typeof fetch !== 'function') return undefined;
    const controller = new AbortController();
    let disposed = false;
    const scheduleRefresh = (event) => {
      if (disposed || refreshTimerRef.current) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        callbackRef.current?.(event);
      }, 350);
    };
    const connect = async () => {
      let retryMs = 1000;
      while (!disposed) {
        try {
          const response = await fetch(`${apiUrl}/api/platform/realtime`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: controller.signal
          });
          if (!response.ok || !response.body) throw new Error(`realtime-${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          retryMs = 1000;
          while (!disposed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = parseEvents(buffer, scheduleRefresh);
          }
        } catch (_error) {
          // Polling below keeps each read model fresh when the stream is unavailable.
        }
        if (disposed) break;
        await new Promise((resolve) => window.setTimeout(resolve, retryMs));
        retryMs = Math.min(retryMs * 2, 15000);
      }
    };
    const fallbackTimer = window.setInterval(() => scheduleRefresh({ eventName: 'poll_fallback' }), 30000);
    connect();
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(fallbackTimer);
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [apiUrl, token, enabled]);
}

export default usePlatformRealtime;
