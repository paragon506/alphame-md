/**
 * YouTube Music Matcher
 * Resolves Spotify track metadata (title, artist, duration) to official YouTube Music
 * studio audio releases (ATV - Audio Track Video), completely avoiding music videos,
 * visualizers, lyric videos, and skits.
 */

const YTM_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search';
const YTM_SONGS_PARAM = 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D'; // Filter: "Songs"

function parseDurationText(durStr) {
  if (!durStr || typeof durStr !== 'string') return 0;
  const parts = durStr.trim().split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Searches YouTube Music specifically for official song releases
 * @param {string} title - Track title
 * @param {string} artist - Track artist(s)
 * @param {number} [targetDurationSec] - Spotify track duration in seconds
 * @returns {Promise<string|null>} YouTube watch URL or null if not found
 */
export async function resolveOfficialTrack(title, artist, targetDurationSec = 0) {
  const query = `${artist || ''} ${title || ''}`.trim();
  if (!query) return null;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);

    const res = await fetch(YTM_SEARCH_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'en',
            gl: 'US',
          },
        },
        query,
        params: YTM_SONGS_PARAM,
      }),
    });

    clearTimeout(timer);
    if (!res.ok) return null;

    const data = await res.json();
    const section =
      data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents?.[0];
    const items = section?.musicShelfRenderer?.contents;
    if (!Array.isArray(items) || !items.length) return null;

    let bestId = null;
    let minDurDiff = Infinity;

    for (const item of items.slice(0, 5)) {
      const r = item.musicResponsiveListItemRenderer;
      if (!r) continue;

      const videoId =
        r.playlistItemData?.videoId ||
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) continue;

      // Extract duration from flex columns if available
      let candidateDur = 0;
      const col2Runs =
        r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      for (const run of col2Runs) {
        if (/^\d+:\d+(?::\d+)?$/.test(run.text?.trim() || '')) {
          candidateDur = parseDurationText(run.text);
          break;
        }
      }

      // Check if item is flagged as Audio Track Video (official release)
      const musicVideoType =
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
          ?.watchEndpointMusicConfig?.musicVideoType;
      const isOfficialAudio = musicVideoType === 'MUSIC_VIDEO_TYPE_ATV';

      if (targetDurationSec > 0 && candidateDur > 0) {
        const diff = Math.abs(candidateDur - targetDurationSec);
        // Prefer official ATV releases when duration diff is close
        const score = diff - (isOfficialAudio ? 3 : 0);
        if (score < minDurDiff) {
          minDurDiff = score;
          bestId = videoId;
        }
      } else if (!bestId || isOfficialAudio) {
        bestId = videoId;
        if (isOfficialAudio) break;
      }
    }

    return bestId ? `https://www.youtube.com/watch?v=${bestId}` : null;
  } catch {
    return null;
  }
}
