import { execFile } from 'node:child_process';
import { MAX_PLAYLIST, YTDLP } from './config.js';
import { getYtDlpCommonArgs } from './sources.js';

export const YOUTUBE_PLAYLIST_REGEX =
  /(?:(?:music\.)?youtube\.com\/(?:playlist\?|watch\?.*?)list=([a-zA-Z0-9_-]+)|youtu\.be\/.*[?&]list=([a-zA-Z0-9_-]+))/i;

export const YOUTUBE_URL_REGEX = /(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com)$/i;

export function isYouTubePlaylistUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return YOUTUBE_PLAYLIST_REGEX.test(url.trim());
}

export function isYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    const h = u.hostname.replace(/^www\./, '');
    return YOUTUBE_URL_REGEX.test(h);
  } catch {
    return false;
  }
}

export function extractYouTubePlaylistId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.trim().match(YOUTUBE_PLAYLIST_REGEX);
  return match ? match[1] || match[2] : null;
}

export function fetchYouTubePlaylist(url, options = {}) {
  return new Promise((resolve, reject) => {
    const maxTracks = options.maxTracks !== undefined ? options.maxTracks : MAX_PLAYLIST;
    const args = ['--flat-playlist', '-J', ...getYtDlpCommonArgs()];
    if (maxTracks > 0) {
      args.push('--playlist-end', String(maxTracks));
    }
    args.push(url.trim());

    execFile(YTDLP, args, { maxBuffer: 64e6, timeout: 180_000 }, (err, out, stderr) => {
      if (err) {
        const errText = (stderr || err.message || '').toString();
        let msg = 'Could not read YouTube playlist (private, removed or unavailable)';
        if (/sign in to confirm you/i.test(errText)) {
          msg =
            'YouTube blocked this request with bot verification. Configure cookies (via cookies.txt or YTDLP_COOKIES_BASE64).';
        } else if (/does not exist/i.test(errText)) {
          msg = 'This YouTube playlist does not exist or has been removed.';
        }
        return reject(
          new Error(err.code === 'ENOENT' ? 'yt-dlp is not installed on this server' : msg),
        );
      }

      try {
        const j = JSON.parse(out);
        const entries = (j.entries || [j]).filter(Boolean);
        const playlistTitle = j.title || 'YouTube Playlist';
        let playlistCover =
          (j.thumbnails && j.thumbnails.length ? j.thumbnails.at(-1)?.url : '') || '';

        const tracks = entries.map((x) => {
          const trackUrl = /^https?:/.test(x.webpage_url || x.url || '')
            ? x.webpage_url || x.url
            : `https://www.youtube.com/watch?v=${x.id}`;
          const title = x.title || x.id || 'YouTube Audio';
          const artist = x.uploader || x.channel || '';
          let cover = x.id ? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg` : '';
          if (!cover && x.thumbnails && x.thumbnails.length) {
            cover = x.thumbnails.at(-1)?.url || '';
          }
          if (!cover) cover = playlistCover;
          const duration = Math.round(Number(x.duration) || 0);

          return {
            id: x.id || '',
            title,
            artist,
            artists: artist ? [artist] : [],
            album: '',
            cover,
            duration,
            duration_ms: duration * 1000,
            source: 'youtube',
            url: trackUrl,
            query: `${title} ${artist}`.trim(),
          };
        });

        if (!playlistCover && tracks.length && tracks[0].cover) {
          playlistCover = tracks[0].cover;
        }

        resolve({
          success: true,
          id: j.id || extractYouTubePlaylistId(url) || '',
          title: playlistTitle,
          description: j.description || '',
          cover: playlistCover,
          total: j.playlist_count || entries.length,
          source: 'youtube',
          tracks,
        });
      } catch (parseErr) {
        reject(new Error('Unexpected response while reading YouTube playlist'));
      }
    });
  });
}
