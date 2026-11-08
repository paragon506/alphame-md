import { $, show } from './dom.js';

const STORAGE = { profile: 'alphame-profile', host: 'alphame-host' };
const DEFAULT_PROFILE = 'auto';

let profile = localStorage.getItem(STORAGE.profile) || DEFAULT_PROFILE;

function applyProfile(next) {
  profile = next;
  document.querySelectorAll('#profileTabs [data-profile]').forEach((tab) => {
    tab.setAttribute('aria-pressed', String(tab.dataset.profile === next));
  });
  show($('#advanced'), next === 'custom', 'flex');
  show($('#autoHint'), next === 'auto');
}

export function getOptions() {
  const format = $('#format').value;
  const minFloor = Number(localStorage.getItem('alphame-min-floor') || 128);
  const rawBr = parseInt($('#bitrate').value, 10);
  const bitrate = Number.isFinite(rawBr) ? Math.max(minFloor, Math.min(320, rawBr)) : 192;
  return {
    profile,
    format,
    bitrate,
    minBitrate: minFloor,
    sampleRate: Number($('#sampleRate').value),
    channels: Number($('#channels').value),
    vbr: $('#vbr').checked && format !== 'm4a',
    host: $('#hostToggle').checked,
  };
}

export function initOptions() {
  const defaultProfile = $('#defaultProfile');
  const defaultHost = $('#defaultHost');
  const defaultFormat = $('#defaultFormat');
  const settingMinFloor = $('#settingMinFloor');
  const panel = $('#settingsPanel');
  const toggle = $('#settingsToggle');

  defaultProfile.value = profile === 'custom' ? DEFAULT_PROFILE : profile;
  defaultHost.checked = localStorage.getItem(STORAGE.host) === '1';
  $('#hostToggle').checked = defaultHost.checked;

  if (settingMinFloor) {
    const savedFloor = localStorage.getItem('alphame-min-floor') || '128';
    settingMinFloor.value = savedFloor;
    const updateFloorLabels = (val) => {
      const autoHint = $('#autoHint');
      if (autoHint) {
        autoHint.textContent = `Picks the best quality per file. Never drops below ${val} kbps floor.`;
      }
    };
    updateFloorLabels(savedFloor);
    settingMinFloor.addEventListener('change', () => {
      localStorage.setItem('alphame-min-floor', settingMinFloor.value);
      updateFloorLabels(settingMinFloor.value);
    });
  }

  if (defaultFormat) {
    const savedFormat = localStorage.getItem('alphame-format') || 'mp3';
    defaultFormat.value = savedFormat;
    $('#format').value = savedFormat;
    defaultFormat.addEventListener('change', () => {
      localStorage.setItem('alphame-format', defaultFormat.value);
      $('#format').value = defaultFormat.value;
    });
  }

  toggle.addEventListener('click', () => {
    const open = panel.classList.contains('hidden');
    show(panel, open, 'flex');
    toggle.setAttribute('aria-expanded', String(open));
  });

  defaultProfile.addEventListener('change', () => {
    localStorage.setItem(STORAGE.profile, defaultProfile.value);
    applyProfile(defaultProfile.value);
  });

  defaultHost.addEventListener('change', () => {
    localStorage.setItem(STORAGE.host, defaultHost.checked ? '1' : '0');
    $('#hostToggle').checked = defaultHost.checked;
  });

  document.querySelectorAll('#profileTabs [data-profile]').forEach((tab) => {
    tab.addEventListener('click', () => applyProfile(tab.dataset.profile));
  });

  // Clamp bitrate input on change/blur
  const bitrateInput = $('#bitrate');
  const clampBitrate = () => {
    const minFloor = Number(localStorage.getItem('alphame-min-floor') || 64);
    let v = parseInt(bitrateInput.value, 10);
    if (!Number.isFinite(v) || v < minFloor) v = minFloor;
    if (v > 320) v = 320;
    bitrateInput.value = v;
    applyProfile('custom');
  };
  bitrateInput.addEventListener('change', clampBitrate);
  bitrateInput.addEventListener('blur', clampBitrate);

  ['format', 'sampleRate', 'channels', 'vbr'].forEach((id) => {
    $(`#${id}`).addEventListener('change', () => {
      if (id === 'format' && $('#format').value === 'm4a') $('#vbr').checked = false;
      applyProfile('custom');
    });
  });

  applyProfile(profile);
}
