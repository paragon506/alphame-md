const CLIENT_KEY = 'alphame-client';
const base = (window.ALPHAME_API || '').replace(/\/$/, '');

function resolveClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export const clientId = resolveClientId();

export function withClient(path) {
  return `${base}${path}${path.includes('?') ? '&' : '?'}c=${clientId}`;
}

export async function request(path, { method = 'GET', json } = {}) {
  const headers = { 'x-client-id': clientId };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

export async function fetchPublic(path) {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error('Unavailable');
  return response.json();
}

export async function fetchPlaylistData(url) {
  return request('/api/playlist', {
    method: 'POST',
    json: { url },
  });
}

export async function searchTracks(query) {
  return request(`/api/search?q=${encodeURIComponent(query)}`);
}

export async function downloadTrack(track, opts) {
  return request('/api/import', {
    method: 'POST',
    json: { track, opts },
  });
}

export async function downloadTracks(tracks, opts) {
  return request('/api/import', {
    method: 'POST',
    json: { tracks, opts },
  });
}

export function uploadFiles(files, options, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('opts', JSON.stringify(options));
    files.forEach((file) => form.append('files', file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/api/upload`);
    xhr.setRequestHeader('x-client-id', clientId);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = {};
      }
      if (xhr.status === 200) return resolve(payload);
      reject(new Error(payload.error || (xhr.status === 413 ? 'File too large' : 'Upload failed')));
    };
    xhr.send(form);
  });
}
