const MEGABYTE = 1024 * 1024;

export function formatBytes(bytes) {
  if (bytes >= MEGABYTE) return `${(bytes / MEGABYTE).toFixed(bytes >= 10 * MEGABYTE ? 1 : 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds) {
  const total = Math.round(seconds || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function minutesLeft(expiresAt) {
  return Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
}

export function formatTtl(minutes) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
