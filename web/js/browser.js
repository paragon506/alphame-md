import { $, show } from './dom.js';
import { searchTracks, downloadTrack } from './api.js';
import { formatDuration } from './format.js';
import { icon } from './icons.js';
import { notify } from './toast.js';
import { wasDownloaded, markDownloaded } from './playlist.js';

let activeGetOptions = () => ({});
let activeOnQueued = () => {};

function renderSearchResult(track) {
  const item = document.createElement('div');
  item.className =
    'flex items-center gap-3.5 p-3 rounded-xl hover:bg-raised/70 transition-all border border-transparent hover:border-edge group';

  const isOld = wasDownloaded(track);
  const durStr = track.duration ? formatDuration(track.duration) : '';

  item.innerHTML = `
    <img
      src="${track.cover}"
      alt=""
      class="size-12 rounded-lg object-cover bg-edge shrink-0 shadow-sm"
      loading="lazy"
      onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23666\\' stroke-width=\\'2\\'%3E%3Cpath d=\\'M9 18V5l12-2v13\\'/ %3E%3C/svg%3E';"
    />
    <div class="min-w-0 flex-1">
      <div class="font-medium text-sm truncate text-fg flex items-center gap-2" title="${track.title}">
        <span class="truncate">${track.title}</span>
        ${isOld ? `<span class="text-[10px] text-accent font-mono bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20 shrink-0">Downloaded</span>` : ''}
      </div>
      <div class="text-xs text-muted truncate flex items-center gap-1.5 mt-0.5">
        <span>${track.artist || 'Unknown Artist'}</span>
        ${track.album ? `<span class="opacity-40">•</span><span class="truncate">${track.album}</span>` : ''}
      </div>
    </div>
    <div class="text-xs text-muted font-mono shrink-0 px-1.5">${durStr}</div>
    <button class="btn ${isOld ? 'border-edge hover:border-edge-strong text-muted hover:text-fg' : 'btn-primary'} text-xs py-1.5 px-3 shrink-0 dl-btn gap-1.5 cursor-pointer">
      ${icon('download')} <span>${isOld ? 'Download again' : 'Download'}</span>
    </button>
  `;

  const btn = item.querySelector('.dl-btn');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<span class="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"></span> Adding…`;
    try {
      await downloadTrack(track, activeGetOptions());
      markDownloaded(track);
      btn.disabled = false;
      btn.innerHTML = `${icon('check')} <span>Queued</span>`;
      btn.className = 'btn border-accent/40 text-accent hover:border-accent text-xs py-1.5 px-3 shrink-0 dl-btn gap-1.5 cursor-pointer';
      notify(`Queued: ${track.title}`);
      activeOnQueued();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
      notify(err.message || 'Download failed');
    }
  });

  return item;
}

export function initBrowser({ getOptions, onQueued }) {
  activeGetOptions = getOptions;
  activeOnQueued = onQueued;

  const input = $('#browserInput');
  const btn = $('#browserBtn');
  const resultsEl = $('#browserResults');
  const statusEl = $('#browserStatus');
  const panel = $('#browserPanel');

  if (!input || !btn) return;

  async function performSearch() {
    const q = input.value.trim();
    if (!q) return;

    btn.disabled = true;
    btn.innerHTML = `<span class="size-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"></span>`;
    statusEl.textContent = 'Searching YouTube Music…';
    show(statusEl, true);
    resultsEl.replaceChildren();

    try {
      const { results } = await searchTracks(q);
      if (!results || !results.length) {
        statusEl.textContent = 'No tracks found. Try a different title or artist.';
        return;
      }
      statusEl.textContent = `Found ${results.length} official song releases:`;
      const frag = document.createDocumentFragment();
      for (const t of results) {
        frag.appendChild(renderSearchResult(t));
      }
      resultsEl.appendChild(frag);
    } catch (err) {
      statusEl.textContent = `Search error: ${err.message || 'Unable to connect'}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('search')} Search`;
    }
  }

  btn.addEventListener('click', performSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  });
}
