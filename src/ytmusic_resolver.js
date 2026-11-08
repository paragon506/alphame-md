const YTM_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search';
const YTM_SONGS_PARAM = 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D';

function parseDurationText(durStr) {
  if (!durStr || typeof durStr !== 'string') return 0;
  const parts = durStr.trim().split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

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

      let candidateDur = 0;
      const col2Runs =
        r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      for (const run of col2Runs) {
        if (/^\d+:\d+(?::\d+)?$/.test(run.text?.trim() || '')) {
          candidateDur = parseDurationText(run.text);
          break;
        }
      }

      const musicVideoType =
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
          ?.watchEndpointMusicConfig?.musicVideoType;
      const isOfficialAudio = musicVideoType === 'MUSIC_VIDEO_TYPE_ATV';

      if (targetDurationSec > 0 && candidateDur > 0) {
        const diff = Math.abs(candidateDur - targetDurationSec);
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

export async function searchYouTubeMusic(query, limit = 15) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim();
  if (!q) return [];

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
        query: q,
        params: YTM_SONGS_PARAM,
      }),
    });

    clearTimeout(timer);
    if (!res.ok) return [];

    const data = await res.json();
    const section =
      data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
        ?.sectionListRenderer?.contents?.[0];
    const items = section?.musicShelfRenderer?.contents || [];

    const results = [];
    for (const item of items.slice(0, limit)) {
      const r = item.musicResponsiveListItemRenderer;
      if (!r) continue;

      const videoId =
        r.playlistItemData?.videoId ||
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) continue;

      const title =
        r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
      const col2Runs =
        r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artist = col2Runs[0]?.text || '';
      let album = '';
      let duration = 0;

      for (let i = 1; i < col2Runs.length; i++) {
        const t = col2Runs[i]?.text?.trim();
        if (/^\d+:\d+(?::\d+)?$/.test(t)) {
          duration = parseDurationText(t);
        } else if (t && t !== '•') {
          album = t;
        }
      }

      results.push({
        id: videoId,
        title,
        artist,
        album,
        duration,
        cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: 'youtube',
        query: `${title} ${artist}`.trim(),
      });
    }

    return results;
  } catch {
    return [];
  }
}
