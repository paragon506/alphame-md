import { $, show } from './dom.js';
import { fetchPlaylistData, downloadTrack, downloadTracks } from './api.js';
import { formatDuration } from './format.js';
import { icon } from './icons.js';
import { notify } from './toast.js';

export const SPOTIFY_PLAYLIST_REGEX =
  /(?:https?:\/\/(?:open\.)?spotify\.com\/(?:(?:intl-[a-zA-Z]{2}|[a-zA-Z]{2}(?:-[a-zA-Z]{2})?|embed)\/)?playlist\/|spotify:playlist:)([a-zA-Z0-9]{22})/i;
export const SPOTIFY_BARE_ID_REGEX = /^[a-zA-Z0-9]{22}$/;

export const YOUTUBE_PLAYLIST_REGEX =
  /(?:(?:music\.)?youtube\.com\/(?:playlist\?|watch\?.*?)list=([a-zA-Z0-9_-]+)|youtu\.be\/.*[?&]list=([a-zA-Z0-9_-]+))/i;

export function isSpotifyUrl(text) {
  if (!text || typeof text !== 'string') return false;
  const s = text.trim();
  return SPOTIFY_PLAYLIST_REGEX.test(s) || SPOTIFY_BARE_ID_REGEX.test(s);
}

export function isYouTubePlaylist(text) {
  if (!text || typeof text !== 'string') return false;
  return YOUTUBE_PLAYLIST_REGEX.test(text.trim());
}

export function isPlaylistLink(text) {
  return isSpotifyUrl(text) || isYouTubePlaylist(text);
}

let currentPlaylist = null;
let currentOnDownloadCallback = null;
let renderedTrackElements = [];

// ── Download history ──────────────────────────────────────────────────────────
const HISTORY_KEY = 'alphame-dl-history';
const HISTORY_MAX = 2000;

function historyLoad() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function historySave(set) {
  try {
    const arr = [...set].slice(-HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {}
}

function historyKey(track) {
  return `${(track.title || '').toLowerCase().trim()}|||${(track.artist || '').toLowerCase().trim()}`;
}

export function markDownloaded(track) {
  const set = historyLoad();
  set.add(historyKey(track));
  historySave(set);
}

export function wasDownloaded(track) {
  return historyLoad().has(historyKey(track));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

function renderTrackItem(track, getOptions, onQueued) {
  const item = document.createElement('div');
  item.className =
    'flex items-center gap-3 p-2 rounded-lg hover:bg-raised/50 transition-colors group';
  item.dataset.query = `${track.title} ${track.artist}`.toLowerCase();

  const coverUrl = track.cover || '';
  const imgHtml = coverUrl
    ? `<img src="${coverUrl}" alt="" class="size-10 rounded-md object-cover bg-edge shrink-0" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="size-10 rounded-md bg-edge items-center justify-center text-muted shrink-0 hidden">${icon('music')}</div>`
    : `<div class="size-10 rounded-md bg-edge flex items-center justify-center text-muted shrink-0">${icon('music')}</div>`;

  const durStr = track.duration ? formatDuration(track.duration) : '';

  item.innerHTML = `
    ${imgHtml}
    <div class="min-w-0 flex-1">
      <div class="font-medium text-sm truncate text-fg" title="${track.title}">${track.title}</div>
      <div class="text-xs text-muted truncate" title="${track.artist || ''}">${track.artist || 'Unknown Artist'}</div>
    </div>
    <div class="text-xs text-muted font-mono shrink-0 px-1">${durStr}</div>
    <button class="btn btn-icon shrink-0 dl-btn" aria-label="Download ${track.title}" title="Download audio">
      ${icon('download')}
    </button>
  `;

  const btn = item.querySelector('.dl-btn');

  // Mark if previously downloaded, but keep button active
  if (wasDownloaded(track)) {
    btn.innerHTML = icon('check');
    btn.classList.add('text-accent');
    btn.title = 'Downloaded previously (click to download again)';
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="size-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin inline-block"></span>`;
    try {
      await downloadTrack(track, getOptions());
      markDownloaded(track);
      btn.innerHTML = icon('check');
      btn.classList.add('text-accent');
      btn.title = 'Queued';
      item.classList.add('opacity-60');
      notify(`Queued: ${track.title}`);
      if (typeof onQueued === 'function') onQueued();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = icon('download');
      notify(err.message || 'Download failed');
    }
  });

  return item;
}

export function initPlaylistUI({ getOptions, onQueued }) {
  const section = $('#playlistSection');
  const tracksListEl = $('#playlistTracks');
  const downloadAllBtn = $('#playlistDownloadAll');
  const closeBtn = $('#playlistClose');
  const searchInput = $('#playlistSearch');
  const searchCountEl = $('#playlistSearchCount');

  currentOnDownloadCallback = onQueued;

  closeBtn?.addEventListener('click', () => {
    hidePlaylist();
  });

  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;
    for (const el of renderedTrackElements) {
      const match = !q || el.dataset.query.includes(q);
      el.style.display = match ? 'flex' : 'none';
      if (match) visibleCount++;
    }
    if (searchCountEl) {
      searchCountEl.textContent = q ? `${visibleCount} of ${renderedTrackElements.length}` : '';
    }
  });

  downloadAllBtn?.addEventListener('click', async () => {
    if (!currentPlaylist || !currentPlaylist.tracks?.length) return;
    downloadAllBtn.disabled = true;
    const originalText = downloadAllBtn.innerHTML;
    downloadAllBtn.textContent = 'Adding all…';

    try {
      await downloadTracks(currentPlaylist.tracks, getOptions());
      // Mark all tracks in download history
      currentPlaylist.tracks.forEach(markDownloaded);
      notify(`Added ${currentPlaylist.tracks.length} tracks to queue`);
      downloadAllBtn.textContent = 'All queued';

      // Update all individual buttons to checked
      tracksListEl.querySelectorAll('.dl-btn').forEach((b) => {
        b.disabled = true;
        b.innerHTML = icon('check');
        b.classList.add('text-accent');
      });
      renderedTrackElements.forEach((el) => el.classList.add('opacity-60'));

      if (typeof currentOnDownloadCallback === 'function') currentOnDownloadCallback();
    } catch (err) {
      downloadAllBtn.disabled = false;
      downloadAllBtn.innerHTML = originalText;
      notify(err.message || 'Failed to queue all tracks');
    }
  });
}

export function hidePlaylist() {
  const section = $('#playlistSection');
  if (section) show(section, false, 'flex');
  currentPlaylist = null;
  renderedTrackElements = [];
}

export function displayPlaylist(playlist, getOptions) {
  currentPlaylist = playlist;
  const section = $('#playlistSection');
  if (!section) return;

  const coverEl = $('#playlistCover');
  const titleEl = $('#playlistTitle');
  const badgeEl = $('#playlistBadge');
  const countEl = $('#playlistCount');
  const descEl = $('#playlistDesc');
  const tracksListEl = $('#playlistTracks');
  const downloadAllBtn = $('#playlistDownloadAll');
  const searchInput = $('#playlistSearch');
  const searchCountEl = $('#playlistSearchCount');

  if (searchInput) searchInput.value = '';
  if (searchCountEl) searchCountEl.textContent = '';

  titleEl.textContent = playlist.title || 'Playlist';
  countEl.textContent = `${playlist.tracks.length.toLocaleString()} tracks`;

  if (playlist.description) {
    descEl.textContent = playlist.description;
    show(descEl, true);
  } else {
    show(descEl, false);
  }

  // Cover
  if (playlist.cover) {
    coverEl.src = playlist.cover;
    show(coverEl, true);
  } else {
    show(coverEl, false);
  }

  // Source Badge (Spotify or YouTube)
  if (playlist.source === 'spotify') {
    badgeEl.className =
      'pill border-accent/40 bg-accent-deep text-accent inline-flex items-center gap-1';
    badgeEl.innerHTML = `${icon('spotify')} Spotify`;
  } else {
    badgeEl.className =
      'pill border-danger/40 bg-[#2a1313] text-danger inline-flex items-center gap-1';
    badgeEl.innerHTML = `${icon('youtube')} YouTube`;
  }

  // Reset Download All button
  downloadAllBtn.disabled = false;
  downloadAllBtn.innerHTML = `${icon('download')} Download all`;

  // Render tracks with DocumentFragment for performance with 1,000+ tracks
  tracksListEl.replaceChildren();
  renderedTrackElements = [];
  const fragment = document.createDocumentFragment();

  playlist.tracks.forEach((track) => {
    const row = renderTrackItem(track, getOptions, currentOnDownloadCallback);
    renderedTrackElements.push(row);
    fragment.appendChild(row);
  });

  tracksListEl.appendChild(fragment);

  show(section, true, 'flex');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export async function loadPlaylistFromUrl(url, getOptions, setMessage) {
  if (setMessage) setMessage('Fetching playlist information…');
  try {
    const data = await fetchPlaylistData(url);
    if (setMessage) setMessage('');
    if (!data.playlist || !data.playlist.tracks || !data.playlist.tracks.length) {
      throw new Error('This playlist contains no tracks or is unavailable');
    }
    displayPlaylist(data.playlist, getOptions);
    notify(`Loaded playlist: "${data.playlist.title}"`);
    return data.playlist;
  } catch (err) {
    if (setMessage) setMessage(err.message);
    notify(err.message);
    throw err;
  }
}
