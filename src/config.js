import path from 'node:path';
import os from 'node:os';

const env = (k, d) => process.env[k] ?? d;
export const PORT = +env('PORT', 3000);
export const WORK = path.resolve(env('WORK_DIR', path.join(os.tmpdir(), 'alphame')));
export const TTL_MS = +env('TTL_MINUTES', 60) * 60_000;
export const MAX_BYTES = +env('MAX_FILE_MB', 200) * 1024 * 1024;
export const CONCURRENCY = Math.max(1, +env('CONCURRENCY', 3));
export const MAX_JOBS = +env('MAX_JOBS', 10000);
export const MAX_PLAYLIST = +env('MAX_PLAYLIST_ITEMS', 0);
export const YTDLP = env('YTDLP_PATH', 'yt-dlp');
export const PYTHON = env('PYTHON_PATH', process.platform === 'win32' ? 'python' : 'python3');
export const SPOTIFY_DELAY_MS = +env('SPOTIFY_DELAY_MS', 400);
export const ALLOW_PRIVATE = env('ALLOW_PRIVATE_URLS', 'false') === 'true';
export const CORS_ORIGIN = env('CORS_ORIGIN', '');
export const PUBLIC_URL = env('PUBLIC_URL', '').replace(/\/$/, '');
export const AUDIO_EXT = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
  '.alac',
  '.ogg',
  '.oga',
  '.opus',
  '.wma',
  '.aiff',
  '.aif',
  '.mp4',
  '.webm',
  '.weba',
]);
export const FORMATS = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg' },
  m4a: { ext: 'm4a', mime: 'audio/mp4' },
  opus: { ext: 'opus', mime: 'audio/ogg' },
  ogg: { ext: 'ogg', mime: 'audio/ogg' },
  flac: { ext: 'flac', mime: 'audio/flac' },
  alac: { ext: 'm4a', mime: 'audio/mp4' },
  wav: { ext: 'wav', mime: 'audio/wav' },
  aiff: { ext: 'aiff', mime: 'audio/aiff' },
};
export const PROFILES = {
  auto: { format: 'mp3', bitrate: 192, vbr: false, auto: true },
  best: { format: 'mp3', bitrate: 320, vbr: true },
  balanced: { format: 'mp3', bitrate: 192, vbr: false },
  small: { format: 'mp3', bitrate: 128, vbr: false, channels: 2 },
};
export const STD_BR = [320, 256, 192, 160, 128, 96, 64];
