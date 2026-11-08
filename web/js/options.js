import { $, show } from './dom.js';

const STORAGE = { profile: 'alphame-profile', host: 'alphame-host' };
const DEFAULT_PROFILE = 'auto';

let profile = localStorage.getItem(STORAGE.profile) || DEFAULT_PROFILE;

function applyProfile(next) {
  profile = next;
  document.querySelectorAll('#profileTabs [data-profile]').forEach((tab) => {
    tab.setAttribute('aria-pressed', String(tab.dataset.profile === next));
  });
  show($('#advanced'), next === 'custom');
  show($('#autoHint'), next === 'auto');
}

export function getOptions() {
  const format = $('#format').value;
  return {
    profile,
    format,
    bitrate: Number($('#bitrate').value),
    sampleRate: Number($('#sampleRate').value),
    channels: Number($('#channels').value),
    vbr: $('#vbr').checked && format !== 'm4a',
    host: $('#hostToggle').checked,
  };
}

export function initOptions() {
  const defaultProfile = $('#defaultProfile');
  const defaultHost = $('#defaultHost');
  const panel = $('#settingsPanel');
  const toggle = $('#settingsToggle');

  defaultProfile.value = profile === 'custom' ? DEFAULT_PROFILE : profile;
  defaultHost.checked = localStorage.getItem(STORAGE.host) === '1';
  $('#hostToggle').checked = defaultHost.checked;

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

  ['format', 'bitrate', 'sampleRate', 'channels', 'vbr'].forEach((id) => {
    $(`#${id}`).addEventListener('change', () => {
      if (id === 'format' && $('#format').value === 'm4a') $('#vbr').checked = false;
      applyProfile('custom');
    });
  });

  applyProfile(profile);
}
