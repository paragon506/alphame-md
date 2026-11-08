import { isSpotifyPlaylistUrl, fetchSpotifyPlaylist } from './spotify_reader.js';
import { isYouTubePlaylistUrl, fetchYouTubePlaylist } from './youtube_reader.js';

export function detectPlaylistSource(url) {
  if (isSpotifyPlaylistUrl(url)) return 'spotify';
  if (isYouTubePlaylistUrl(url)) return 'youtube';
  return null;
}

export function normalizeTrack(track, fallbackSource = 'spotify') {
  const title = String(track.title || track.name || 'Unknown Title').trim();
  const artist = String(
    track.artist || (Array.isArray(track.artists) ? track.artists.join(', ') : '') || '',
  ).trim();
  const source = track.source || fallbackSource;
  const cover = String(track.cover || track.image || '').trim();
  const duration =
    typeof track.duration === 'number'
      ? track.duration
      : typeof track.duration_ms === 'number'
        ? Math.round(track.duration_ms / 1000)
        : 0;
  const id = String(track.id || '').trim();
  const query = track.query || `${title} ${artist}`.trim();
  const url =
    track.url || (source === 'youtube' && id ? `https://www.youtube.com/watch?v=${id}` : '');

  return {
    id,
    title,
    artist: artist || (source === 'youtube' ? 'YouTube' : 'Unknown Artist'),
    cover,
    duration,
    source,
    query,
    url,
  };
}

export function normalizePlaylist(raw, source) {
  const tracks = (raw.tracks || []).map((t) => normalizeTrack(t, source));
  return {
    id: String(raw.id || ''),
    title: String(raw.title || raw.name || 'Playlist').trim(),
    description: String(raw.description || '').trim(),
    cover: String(raw.cover || '').trim(),
    total: typeof raw.total === 'number' ? raw.total : tracks.length,
    source,
    tracks,
  };
}

export async function fetchPlaylist(url, options = {}) {
  const source = detectPlaylistSource(url);
  if (!source) {
    throw new Error('Unsupported playlist URL. Please provide a Spotify or YouTube playlist link.');
  }

  let raw;
  if (source === 'spotify') {
    raw = await fetchSpotifyPlaylist(url, options);
  } else if (source === 'youtube') {
    raw = await fetchYouTubePlaylist(url, options);
  }

  const normalized = normalizePlaylist(raw, source);

  if (!normalized.tracks.length) {
    throw new Error('The playlist was found but contains no tracks.');
  }

  return normalized;
}
