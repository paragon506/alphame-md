import fs from 'node:fs';
import path from 'node:path';

if (process.platform === 'win32') {
  const shutterPath = 'C:\\Program Files\\Shutter Encoder\\app\\Library';
  if (fs.existsSync(shutterPath) && !process.env.PATH?.includes(shutterPath)) {
    process.env.PATH = `${shutterPath};${process.env.PATH || ''}`;
  }
  const pythonScripts =
    'C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.15-64\\Scripts';
  if (fs.existsSync(pythonScripts) && !process.env.PATH?.includes(pythonScripts)) {
    process.env.PATH = `${pythonScripts};${process.env.PATH || ''}`;
  }
}

const env = (k, d) => process.env[k] ?? d;
export const PORT = +env('PORT', 3000);
export const WORK = path.resolve(
  env('WORK_DIR', path.join(process.env.TMPDIR || '/tmp', 'alphame')),
);
export const TTL_MS = +env('TTL_MINUTES', 60) * 60_000;
export const MAX_BYTES = +env('MAX_FILE_MB', 200) * 1024 * 1024;
export const CONCURRENCY = Math.max(1, +env('CONCURRENCY', 2));
export const MAX_JOBS = +env('MAX_JOBS', 10000);
export const MAX_PLAYLIST = +env('MAX_PLAYLIST_ITEMS', 0);
export const YTDLP = env('YTDLP_PATH', 'yt-dlp');
export const PYTHON = env('PYTHON_PATH', process.platform === 'win32' ? 'python' : 'python3');
export const SPOTIFY_DELAY_MS = +env('SPOTIFY_DELAY_MS', 400);
export const ALLOW_PRIVATE = env('ALLOW_PRIVATE_URLS', 'false') === 'true';
export const CORS_ORIGIN = env('CORS_ORIGIN', '');
export const PUBLIC_URL = env('PUBLIC_URL', '').replace(/\/$/, '');
export const AUDIO_EXT = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga',
  '.opus', '.wma', '.aiff', '.aif', '.mp4', '.webm', '.weba',
]);
export const FORMATS = {
  mp3:  { ext: 'mp3',  mime: 'audio/mpeg' },
  m4a:  { ext: 'm4a',  mime: 'audio/mp4'  },
  opus: { ext: 'opus', mime: 'audio/ogg'  },
  ogg:  { ext: 'ogg',  mime: 'audio/ogg'  },
};
export const PROFILES = {
  auto:     { format: 'mp3', bitrate: 192, vbr: false, auto: true },
  best:     { format: 'mp3', bitrate: 320, vbr: true },
  balanced: { format: 'mp3', bitrate: 192, vbr: false },
  // raised from 96 → 128 kbps minimum
  small:    { format: 'mp3', bitrate: 128, vbr: false, channels: 2 },
};
// Allowed discrete bitrates — minimum is 128 kbps
export const STD_BR = [320, 256, 192, 160, 128];
