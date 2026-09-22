export function encodePurposeHeader(purpose = '') {
  return encodeURIComponent(String(purpose || '').trim()).slice(0, 512);
}

export function buildRealtimeHeaders({ token, purpose = '' } = {}) {
  const purposeHeader = encodePurposeHeader(purpose);
  return {
    Authorization: `Bearer ${token || ''}`,
    Accept: 'text/event-stream',
    ...(purposeHeader ? { 'X-Purpose-Scope': purposeHeader } : {})
  };
}

export function shouldRetryRealtimeStatus(status) {
  const numericStatus = Number(status);
  return !Number.isInteger(numericStatus) || numericStatus < 400 || numericStatus >= 500;
}
