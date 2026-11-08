import { $, show } from './dom.js';
import { request, withClient } from './api.js';
import { icon } from './icons.js';
import { formatBytes, formatDuration, minutesLeft } from './format.js';
import { notify } from './toast.js';
import { getOptions } from './options.js';

const ACTIVE = new Set(['queued', 'downloading', 'analyzing', 'processing']);
const SETTLED = new Set(['done', 'error', 'canceled']);
const LABELS = {
  queued: 'Queued',
  downloading: 'Downloading',
  analyzing: 'Analyzing',
  processing: 'Compressing',
  done: 'Done',
  error: 'Failed',
  canceled: 'Canceled',
};

const rows = new Map();
const STORAGE_JOBS_KEY = 'alphame-cached-jobs';

export function loadCachedJobs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_JOBS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveCachedJobs(list) {
  try {
    const doneOnly = list.filter((j) => j.status === 'done').slice(-200);
    localStorage.setItem(STORAGE_JOBS_KEY, JSON.stringify(doneOnly));
  } catch {}
}

export function clearQueueStorage() {
  localStorage.removeItem(STORAGE_JOBS_KEY);
}

export function clearDoneRows() {
  clearQueueStorage();
  for (const [id, r] of [...rows.entries()]) {
    if (!isActive(r.job)) {
      r.element.remove();
      rows.delete(id);
    }
  }
  updateQueueDisplay();
}

export function removeCachedJob(id) {
  try {
    const list = loadCachedJobs().filter((j) => j.id !== id);
    localStorage.setItem(STORAGE_JOBS_KEY, JSON.stringify(list));
  } catch {}
}

export const isActive = (job) => ACTIVE.has(job.status);

function createRow() {
  const element = $('#rowTemplate').content.firstElementChild.cloneNode(true);
  const part = (role) => $(`[data-role="${role}"]`, element);
  return {
    element,
    cover: part('cover'),
    title: part('title'),
    sub: part('sub'),
    pill: part('pill'),
    actions: part('actions'),
    bar: part('bar'),
    result: part('result'),
    sizes: part('sizes'),
    saved: part('saved'),
    meta: part('meta'),
    player: part('player'),
    expired: part('expired'),
    editor: part('editor'),
    error: part('error'),
    job: null,
    actionsKey: '',
    playerReady: false,
    editorBound: false,
    coverSet: false,
  };
}

async function copyDirectLink(job, refresh) {
  try {
    if (!job.hosted)
      await request(`/api/jobs/${job.id}/host`, { method: 'POST', json: { on: true } });
    const { url } = await request(`/api/jobs/${job.id}/link`);
    await navigator.clipboard.writeText(url);
    notify('Direct link copied');
    refresh();
  } catch (error) {
    notify(error.message || 'Could not copy');
  }
}

function toggleEditor(row) {
  const opening = row.editor.classList.contains('hidden');
  if (opening) {
    for (const [name, value] of Object.entries(row.job.tags))
      row.editor.elements[name].value = value;
  }
  show(row.editor, opening, 'grid');
}

function bindEditor(row, refresh) {
  if (row.editorBound) return;
  row.editorBound = true;
  row.editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const fields = Object.fromEntries(new FormData(row.editor));
      await request(`/api/jobs/${row.job.id}/tags`, { method: 'POST', json: fields });
      show(row.editor, false, 'grid');
      notify('Tags saved');
      refresh();
    } catch (error) {
      notify(error.message);
    }
  });
  $('[data-role="cancelEdit"]', row.element).addEventListener('click', () =>
    show(row.editor, false, 'grid'),
  );
}

function actionsFor(row, job, refresh) {
  const post = (path) => request(`/api/jobs/${job.id}/${path}`, { method: 'POST' });
  const items = [];
  if (isActive(job)) {
    items.push({ icon: 'cancel', label: 'Cancel', run: () => post('cancel').then(refresh) });
  }
  if (job.status === 'error' || job.status === 'canceled') {
    items.push({
      icon: 'retry',
      label: 'Retry',
      run: () =>
        post('retry')
          .then(refresh)
          .catch((error) => notify(error.message)),
    });
  }
  if (job.status === 'done') {
    items.push({
      icon: 'download',
      label: 'Download',
      href: withClient(`/api/jobs/${job.id}/download`),
    });
    items.push({
      icon: 'recompress',
      label: 'Recompress with current settings',
      run: async () => {
        try {
          await request(`/api/jobs/${job.id}/recompress`, {
            method: 'POST',
            json: { opts: getOptions() },
          });
          notify(`Recompressing: ${job.title}`);
          refresh();
        } catch (error) {
          notify(error.message || 'Recompress failed');
        }
      },
    });
    items.push({
      icon: 'link',
      label: job.hosted ? 'Copy direct link' : 'Create direct link',
      run: () => copyDirectLink(job, refresh),
    });
    items.push({ icon: 'edit', label: 'Edit tags', run: () => toggleEditor(row) });
  }
  if (!isActive(job)) {
    items.push({
      icon: 'trash',
      label: 'Remove',
      danger: true,
      run: async () => {
        const r = rows.get(job.id);
        if (r) {
          r.element.remove();
          rows.delete(job.id);
        }
        removeCachedJob(job.id);
        updateQueueDisplay();
        try {
          await request(`/api/jobs/${job.id}`, { method: 'DELETE' });
        } catch {}
      },
    });
  }
  return items;
}

function buildAction(item) {
  const control = document.createElement(item.href ? 'a' : 'button');
  control.className = `btn btn-icon ${item.danger ? 'hover:text-danger hover:border-danger/40' : ''}`;
  control.title = item.label;
  control.setAttribute('aria-label', item.label);
  control.innerHTML = icon(item.icon);
  if (item.href) {
    control.href = item.href;
    control.setAttribute('download', '');
  } else {
    control.addEventListener('click', item.run);
  }
  return control;
}

function updateResult(row, job) {
  const savedPercent = job.origSize ? Math.round((1 - job.newSize / job.origSize) * 100) : 0;
  row.sizes.textContent = `${formatBytes(job.origSize)} → ${formatBytes(job.newSize)}`;
  row.saved.textContent = `${savedPercent > 0 ? `−${savedPercent}` : 0}% saved`;
  const meta = [job.format ? job.format.toUpperCase() : 'MP3', job.note];
  if (job.hosted) meta.push(`public link · expires in ${minutesLeft(job.expiresAt)} min`);
  row.meta.textContent = meta.filter(Boolean).join(' · ');

  const canPlay = !job.fromCache && job.hasAudio !== false;
  if (!canPlay) {
    if (row.player) {
      row.player.removeAttribute('src');
      row.player.style.display = 'none';
    }
    if (row.expired) show(row.expired, true, 'flex');
  } else {
    if (row.expired) show(row.expired, false, 'flex');
    if (row.player) {
      row.player.style.display = '';
      if (!row.playerReady) {
        row.player.src = withClient(`/api/jobs/${job.id}/audio?t=${job.finished || Date.now()}`);
        row.player.addEventListener('error', () => {
          row.player.style.display = 'none';
          if (row.expired) show(row.expired, true, 'flex');
        });
        row.player.addEventListener('play', () => {
          if (row.player.error) {
            row.player.style.display = 'none';
            if (row.expired) show(row.expired, true, 'flex');
          }
        });
        row.playerReady = true;
      }
    }
  }
}

function updateRow(row, job, refresh) {
  row.job = job;
  if (isActive(job)) row.playerReady = false;
  bindEditor(row, refresh);
  if (job.status !== 'done') show(row.editor, false, 'grid');
  row.title.textContent = job.artist ? `${job.title} — ${job.artist}` : job.title;
  row.sub.textContent = [job.filename, job.duration && formatDuration(job.duration), job.srcInfo]
    .filter(Boolean)
    .join(' · ');

  // cover art
  if (row.cover && !row.coverSet && job.cover) {
    const img = document.createElement('img');
    img.src = job.cover;
    img.alt = '';
    img.className = 'w-full h-full object-cover';
    img.onerror = () => {};
    row.cover.replaceChildren(img);
    row.coverSet = true;
  }

  const label = LABELS[job.status];
  row.pill.dataset.status = job.status;
  row.pill.textContent =
    isActive(job) && job.status !== 'queued' && job.progress ? `${label} ${job.progress}%` : label;

  const settled = SETTLED.has(job.status);
  row.bar.hidden = settled;
  row.bar.dataset.indeterminate = String(
    job.status === 'queued' ||
      job.status === 'analyzing' ||
      (job.status === 'downloading' && !job.progress),
  );
  row.bar.firstElementChild.style.width = `${job.progress}%`;

  row.error.textContent = job.error;
  show(row.error, Boolean(job.error));

  const actionsKey = `${job.status}:${job.hosted}:${job.fromCache}`;
  if (row.actionsKey !== actionsKey) {
    row.actionsKey = actionsKey;
    row.actions.replaceChildren(...actionsFor(row, job, refresh).map(buildAction));
  }

  show(row.result, job.status === 'done', 'flex');
  if (job.status === 'done') updateResult(row, job);
}

export function updateQueueDisplay() {
  const currentJobs = [...rows.values()].map((r) => r.job).filter(Boolean);
  const done = currentJobs.filter((job) => job.status === 'done').length;
  const doneFromServer = currentJobs.filter((job) => job.status === 'done' && !job.fromCache).length;
  const active = currentJobs.filter(isActive);
  const progress = currentJobs.reduce(
    (sum, job) => sum + (SETTLED.has(job.status) ? 100 : job.progress || 0),
    0,
  );

  $('#emptyState').hidden = currentJobs.length > 0;
  $('#zipBtn').disabled = doneFromServer === 0;
  $('#clearBtn').disabled = currentJobs.length === 0;

  const countEl = $('#queueCount');
  if (countEl) {
    if (currentJobs.length > 0) {
      countEl.textContent = `${done}/${currentJobs.length} done`;
      countEl.className =
        'text-xs text-accent font-mono bg-accent/10 px-2.5 py-0.5 rounded-full border border-accent/20';
      countEl.hidden = false;
    } else {
      countEl.textContent = '';
      countEl.className = 'hidden';
      countEl.hidden = true;
    }
  }

  $('#batchBar').hidden = active.length === 0;
  if (active.length)
    $('#batchBar').firstElementChild.style.width = `${Math.round(progress / currentJobs.length)}%`;
}

export function renderQueue(jobs, refresh) {
  // If server returns jobs, cache completed ones; if server restarted and is empty, restore cache
  if (Array.isArray(jobs) && jobs.length > 0) {
    saveCachedJobs(jobs);
  } else {
    const cached = loadCachedJobs();
    if (cached.length > 0) jobs = cached.map((j) => ({ ...j, fromCache: true }));
  }

  const list = $('#queueList');
  const seen = new Set();

  jobs.forEach((job, index) => {
    seen.add(job.id);
    let row = rows.get(job.id);
    if (!row) {
      row = createRow();
      rows.set(job.id, row);
    }
    if (list.children[index] !== row.element)
      list.insertBefore(row.element, list.children[index] || null);
    updateRow(row, job, refresh);
  });

  for (const [id, row] of rows) {
    if (seen.has(id)) continue;
    row.element.remove();
    rows.delete(id);
  }

  updateQueueDisplay();
  const active = jobs.filter(isActive);
  return active.length > 0;
}
