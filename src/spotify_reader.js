import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PYTHON, MAX_PLAYLIST, SPOTIFY_DELAY_MS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'spotify_reader.py');

// In-memory cache to prevent redundant requests and protect against IP rate limits
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export const SPOTIFY_PLAYLIST_REGEX =
  /(?:https?:\/\/(?:open\.)?spotify\.com\/(?:(?:intl-[a-zA-Z]{2}|[a-zA-Z]{2}(?:-[a-zA-Z]{2})?|embed)\/)?playlist\/|spotify:playlist:)([a-zA-Z0-9]{22})/i;
export const SPOTIFY_BARE_ID_REGEX = /^[a-zA-Z0-9]{22}$/;

export function isSpotifyPlaylistUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  return SPOTIFY_PLAYLIST_REGEX.test(s) || SPOTIFY_BARE_ID_REGEX.test(s);
}

export function extractSpotifyPlaylistId(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const match = s.match(SPOTIFY_PLAYLIST_REGEX);
  if (match) return match[1];
  if (SPOTIFY_BARE_ID_REGEX.test(s)) return s;
  return null;
}

export function fetchSpotifyPlaylist(url, options = {}) {
  return new Promise((resolve, reject) => {
    const playlistId = extractSpotifyPlaylistId(url);
    if (!playlistId) {
      return reject(
        new Error(
          'Invalid Spotify playlist URL. Please provide a link formatted as https://open.spotify.com/playlist/{id}',
        ),
      );
    }

    // Check cache first
    const cached = cache.get(playlistId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return resolve(cached.data);
    }

    const maxTracks = options.maxTracks !== undefined ? options.maxTracks : MAX_PLAYLIST || 0;
    const delaySec = (options.delayMs ?? SPOTIFY_DELAY_MS) / 1000;

    const args = [
      SCRIPT_PATH,
      url.trim(),
      '--max-tracks',
      String(maxTracks),
      '--delay',
      String(delaySec),
    ];

    execFile(
      PYTHON,
      args,
      { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let data;
        try {
          const text = (stdout || '').trim() || (stderr || '').trim();
          if (text) {
            data = JSON.parse(text);
          }
        } catch (parseErr) {
          // Fall through to error handler
        }

        if (data && data.success === false) {
          return reject(new Error(data.error || 'Could not read Spotify playlist'));
        }

        if (err) {
          const msg =
            data?.error ||
            stderr.trim() ||
            (err.code === 'ENOENT'
              ? 'Python is not available on this server to read Spotify playlists'
              : err.message);
          return reject(new Error(msg));
        }

        if (!data || !Array.isArray(data.tracks)) {
          return reject(new Error('Invalid or unreadable response from Spotify reader'));
        }

        // Store in cache
        cache.set(playlistId, {
          timestamp: Date.now(),
          data,
        });

        resolve(data);
      },
    );
  });
}
