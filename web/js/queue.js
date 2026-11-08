import { $, show } from './dom.js';
import { request, withClient } from './api.js';
import { icon } from './icons.js';
import { formatBytes, formatDuration, minutesLeft } from './format.js';
import { notify } from './toast.js';

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

export const isActive = (job) => ACTIVE.has(job.status);

function createRow() {
  const element = $('#rowTemplate').content.firstElementChild.cloneNode(true);
  const part = (role) => $(`[data-role="${role}"]`, element);
  return {
    element,
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
    editor: part('editor'),
    error: part('error'),
    job: null,
    actionsKey: '',
    playerReady: false,
    editorBound: false,
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
      run: () => request(`/api/jobs/${job.id}`, { method: 'DELETE' }).then(refresh),
    });
  }
  return items;
}

function buildAction(item) {
  const control = document.createElement(item.href ? 'a' : 'button');
  control.className = 'btn btn-icon';
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
  const meta = [job.format.toUpperCase(), job.note];
  if (job.hosted) meta.push(`public link · expires in ${minutesLeft(job.expiresAt)} min`);
  row.meta.textContent = meta.filter(Boolean).join(' · ');
  if (!row.playerReady) {
    row.player.src = withClient(`/api/jobs/${job.id}/audio`);
    row.playerReady = true;
  }
}

function updateRow(row, job, refresh) {
  row.job = job;
  bindEditor(row, refresh);
  if (job.status !== 'done') show(row.editor, false, 'grid');
  row.title.textContent = job.artist ? `${job.title} — ${job.artist}` : job.title;
  row.sub.textContent = [job.filename, job.duration && formatDuration(job.duration), job.srcInfo]
    .filter(Boolean)
    .join(' · ');

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

  const actionsKey = `${job.status}:${job.hosted}`;
  if (row.actionsKey !== actionsKey) {
    row.actionsKey = actionsKey;
    row.actions.replaceChildren(...actionsFor(row, job, refresh).map(buildAction));
  }

  show(row.result, job.status === 'done', 'flex');
  if (job.status === 'done') updateResult(row, job);
}

export function renderQueue(jobs, refresh) {
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

  const done = jobs.filter((job) => job.status === 'done').length;
  const active = jobs.filter(isActive);
  const progress = jobs.reduce(
    (sum, job) => sum + (SETTLED.has(job.status) ? 100 : job.progress || 0),
    0,
  );

  $('#emptyState').hidden = jobs.length > 0;
  $('#zipBtn').disabled = done === 0;
  $('#clearBtn').disabled = !jobs.some((job) => !isActive(job));
  $('#queueCount').textContent = jobs.length ? `${done}/${jobs.length} done` : '';
  $('#batchBar').hidden = active.length === 0;
  if (active.length)
    $('#batchBar').firstElementChild.style.width = `${Math.round(progress / jobs.length)}%`;

  return active.length > 0;
}
