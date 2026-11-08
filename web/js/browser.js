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
    'flex items-center gap-3.5 p-2.5 rounded-xl hover:bg-raised/70 transition-all border border-transparent hover:border-edge group';

  const isOld = wasDownloaded(track);
  if (isOld) item.classList.add('opacity-60');

  const durStr = track.duration ? formatDuration(track.duration) : '';

  item.innerHTML = `
    <img
      src="${track.cover}"
      alt=""
      class="size-11 rounded-lg object-cover bg-edge shrink-0"
      loading="lazy"
      onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23666\\' stroke-width=\\'2\\'%3E%3Cpath d=\\'M9 18V5l12-2v13\\'/ %3E%3C/svg%3E';"
    />
    <div class="min-w-0 flex-1">
      <div class="font-medium text-sm truncate text-fg" title="${track.title}">${track.title}</div>
      <div class="text-xs text-muted truncate flex items-center gap-1.5 mt-0.5">
        <span>${track.artist || 'Unknown Artist'}</span>
        ${track.album ? `<span class="opacity-40">•</span><span class="truncate">${track.album}</span>` : ''}
      </div>
    </div>
    <div class="text-xs text-muted font-mono shrink-0 px-1.5">${durStr}</div>
    <button class="btn btn-primary text-xs py-1.5 px-3 shrink-0 dl-btn gap-1.5">
      ${isOld ? `${icon('check')} Queued` : `${icon('download')} Download`}
    </button>
  `;

  const btn = item.querySelector('.dl-btn');
  if (isOld) {
    btn.disabled = true;
    btn.classList.remove('btn-primary');
    btn.classList.add('border-accent/40', 'text-accent');
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<span class="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"></span> Adding…`;
    try {
      await downloadTrack(track, activeGetOptions());
      markDownloaded(track);
      btn.innerHTML = `${icon('check')} Queued`;
      btn.classList.remove('btn-primary');
      btn.classList.add('border-accent/40', 'text-accent');
      item.classList.add('opacity-60');
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
