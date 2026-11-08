import { $ } from './dom.js';
import { request, fetchPublic, uploadFiles, withClient } from './api.js';
import { formatTtl } from './format.js';
import { getOptions, initOptions } from './options.js';
import { renderQueue, clearQueueStorage } from './queue.js';
import { notify } from './toast.js';
import { initBrowser } from './browser.js';
import {
  initPlaylistUI,
  loadPlaylistFromUrl,
  isSpotifyUrl,
  isYouTubePlaylist,
  isPlaylistLink,
  clearHistory,
} from './playlist.js';

const AUDIO_PATTERN = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aiff?|mp4|webm|weba)$/i;
const POLL_ACTIVE_MS = 700;
const POLL_IDLE_MS = 5000;
const HEALTH_MS = 15000;

let pollTimer;
let polling = false;

async function poll() {
  clearTimeout(pollTimer);
  if (polling) return;
  polling = true;
  let active = false;
  try {
    const { jobs } = await request('/api/jobs');
    active = renderQueue(jobs, poll);
  } catch {
    active = false;
  }
  polling = false;
  pollTimer = setTimeout(poll, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
}

function setMessage(text) {
  $('#uploadMessage').textContent = text;
}

async function handleFiles(fileList) {
  const files = [...fileList].filter(
    (file) => AUDIO_PATTERN.test(file.name) || file.type.startsWith('audio/'),
  );
  if (!files.length) return notify('No supported audio files');
  try {
    const label = `${files.length} file${files.length > 1 ? 's' : ''}`;
    const { jobs } = await uploadFiles(files, getOptions(), (percent) =>
      setMessage(`Uploading ${label}… ${percent}%`),
    );
    notify(`${jobs.length} added`);
    poll();
  } catch (error) {
    notify(error.message);
  } finally {
    setMessage('');
  }
}

async function handleImport() {
  const text = $('#urlInput').value.trim();
  if (!text) return notify('Paste a link first');
  const button = $('#importBtn');
  button.disabled = true;

  if (isPlaylistLink(text)) {
    const isSp = isSpotifyUrl(text);
    setMessage(isSp ? 'Reading Spotify playlist…' : 'Reading YouTube playlist…');
    try {
      await loadPlaylistFromUrl(text, getOptions, setMessage);
      $('#urlInput').value = '';
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }

  setMessage('Reading links…');
  try {
    const { jobs, problems } = await request('/api/import', {
      method: 'POST',
      json: { text, opts: getOptions() },
    });
    $('#urlInput').value = '';
    notify(`${jobs.length} added${problems.length ? ` · ${problems.length} skipped` : ''}`);
    setMessage(problems[0] || '');
    poll();
  } catch (error) {
    setMessage(error.message);
  } finally {
    button.disabled = false;
  }
}

function initDropzone() {
  const zone = $('#dropzone');
  const input = $('#fileInput');
  $('#pickFiles').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    handleFiles(input.files);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.dataset.over = 'true';
    }),
  );
  ['dragleave', 'drop'].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.dataset.over = 'false';
    }),
  );
  zone.addEventListener('drop', (event) => handleFiles(event.dataTransfer.files));
}

async function refreshStatus() {
  const dot = $('#statusDot');
  try {
    const [health, info] = await Promise.all([fetchPublic('/health'), fetchPublic('/api/info')]);
    dot.dataset.state = 'ok';
    if (health.running > 0) {
      $('#statusText').textContent =
        `${health.running} job${health.running > 1 ? 's' : ''} running`;
    } else if (health.jobs > 0) {
      $('#statusText').textContent = `${health.jobs} in queue`;
    } else {
      $('#statusText').textContent = 'Working';
    }
    document.querySelectorAll('[data-ttl]').forEach((element) => {
      element.textContent = formatTtl(info.ttlMinutes);
    });
    const youtube = info.ytdlp ? '' : '. YouTube import is unavailable on this server';
    $('#limitsNote').textContent = `Max ${info.maxFileMB} MB per file${youtube}.`;
  } catch {
    dot.dataset.state = 'down';
    $('#statusText').textContent = 'Offline';
  }
}

initOptions();
initDropzone();
initBrowser({ getOptions, onQueued: poll });
initPlaylistUI({ getOptions, onQueued: poll });

const urlInput = $('#urlInput');
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleImport();
  }
});
urlInput.addEventListener('input', () => {
  const val = urlInput.value.trim();
  if (isSpotifyUrl(val)) {
    setMessage('Spotify playlist detected. Click Import or press Enter to read tracks.');
  } else if (isYouTubePlaylist(val)) {
    setMessage('YouTube playlist detected. Click Import or press Enter to read tracks.');
  } else if ($('#uploadMessage').textContent.includes('playlist detected')) {
    setMessage('');
  }
});

$('#importBtn').addEventListener('click', handleImport);
$('#zipBtn').addEventListener('click', () => {
  location.href = withClient('/api/zip');
});
$('#clearBtn').addEventListener('click', () => {
  clearQueueStorage();
  request('/api/clear', { method: 'POST' }).catch(() => {}).then(poll);
});

const autoClearSetting = $('#settingAutoClear');
if (autoClearSetting) {
  autoClearSetting.checked = localStorage.getItem('alphame_autoclear') === 'true';
  autoClearSetting.addEventListener('change', () => {
    localStorage.setItem('alphame_autoclear', String(autoClearSetting.checked));
  });
  if (autoClearSetting.checked) {
    clearQueueStorage();
  }
}

$('#clearHistoryBtn')?.addEventListener('click', () => {
  clearQueueStorage();
  clearHistory();
  notify('History cleared');
  poll();
});
refreshStatus();
setInterval(refreshStatus, HEALTH_MS);
poll();
