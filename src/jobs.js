import fs from 'node:fs';
import path from 'node:path';
import { WORK, TTL_MS, MAX_BYTES, MAX_JOBS, CONCURRENCY, FORMATS } from './config.js';
import { now, id, rm, sizeOf, safeName, stripExt } from './utils.js';
import { probe, encode } from './media.js';
import { emptyTags, readTags, cleanArtist, sanitizeTags, rewriteTags } from './tags.js';
import { downloadDirect, ytDownload } from './sources.js';
import { resolveOfficialTrack } from './ytmusic_resolver.js';

export const jobs = new Map();
const queue = [];
let running = 0;

const STORE_PATH = path.join(path.dirname(WORK), '.alphame_jobs_store.json');

function serializeJob(j) {
  return {
    id: j.id,
    client: j.client,
    status: j.status,
    progress: j.progress,
    title: j.title,
    artist: j.artist,
    cover: j.cover,
    filename: j.filename,
    outName: j.outName,
    duration: j.duration,
    origSize: j.origSize,
    newSize: j.newSize,
    format: j.opts?.format,
    opts: j.opts,
    note: j.note,
    error: j.error,
    hosted: j.hosted,
    srcInfo: j.srcInfo,
    created: j.created,
    finished: j.finished,
    out: j.out,
    source: j.source,
    tags: j.tags,
  };
}

export function persistJobs() {
  try {
    const list = [...jobs.values()]
      .filter((j) => j.status === 'done' && j.out && fs.existsSync(j.out))
      .map(serializeJob);
    fs.writeFileSync(STORE_PATH, JSON.stringify(list), 'utf8');
  } catch {}
}

export function restoreJobs() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '[]');
    for (const item of raw) {
      if (item.out && fs.existsSync(item.out)) {
        jobs.set(item.id, {
          ...item,
          proc: null,
          abort: null,
          src: null,
        });
      }
    }
  } catch {}
}

restoreJobs();

export const stats = () => ({ jobs: jobs.size, running });

export function requeue(job) {
  queue.push(job.id);
  pump();
}

export function newJob(client, props) {
  if (jobs.size >= MAX_JOBS) throw new Error('Server is busy, clear some finished jobs first');
  const j = {
    id: id(),
    client,
    status: 'queued',
    progress: 0,
    title: '',
    filename: '',
    duration: 0,
    origSize: 0,
    newSize: 0,
    format: '',
    note: '',
    error: '',
    hosted: false,
    created: now(),
    finished: 0,
    canceled: false,
    proc: null,
    abort: null,
    src: null,
    out: null,
    ...props,
  };
  jobs.set(j.id, j);
  queue.push(j.id);
  pump();
  return j;
}
export function pump() {
  while (running < CONCURRENCY && queue.length) {
    const j = jobs.get(queue.shift());
    if (!j || j.status !== 'queued') continue;
    running++;
    runJob(j).finally(() => {
      running--;
      pump();
    });
  }
}
function outputName(job) {
  const { title = '', artist = '' } = job.tags || {};
  const label = title ? (artist ? `${artist} - ${title}` : title) : stripExt(job.filename);
  return `${safeName(label)}.${FORMATS[job.opts.format].ext}`;
}

async function settleTags(job) {
  const tags = readTags((await probe(job.out)).tags);
  const fixes = {};
  const artist = cleanArtist(tags.artist || job.artist);
  if (artist !== tags.artist) fixes.artist = artist;
  if (!tags.title && ['yt', 'youtube'].includes(job.source?.type) && job.title)
    fixes.title = job.title;
  if (job.source?.type === 'spotify' || job.source?.type === 'youtube') {
    if (job.title && job.title !== tags.title) fixes.title = job.title;
    if (job.artist && job.artist !== tags.artist) fixes.artist = job.artist;
    if (job.album && job.album !== tags.album) fixes.album = job.album;
  }
  if (Object.keys(fixes).length) await rewriteTags(job.out, fixes);
  job.tags = { ...tags, ...fixes };
  job.title = job.tags.title || job.title;
  job.artist = job.tags.artist || job.artist;
}

export async function updateTags(job, input) {
  if (job.status !== 'done') throw new Error('Not ready');
  const tags = sanitizeTags(input);
  if (!Object.keys(tags).length) throw new Error('Nothing to update');
  await rewriteTags(job.out, tags);
  job.tags = { ...job.tags, ...tags };
  job.title = job.tags.title || stripExt(job.filename);
  job.artist = job.tags.artist;
  job.newSize = sizeOf(job.out);
  job.outName = outputName(job);
}

export async function runJob(job) {
  try {
    if (!job.src) {
      job.status = 'downloading';
      job.progress = 0;
      const dest = path.join(WORK, `${job.id}.src`);
      const isYt = ['yt', 'youtube', 'ytmusic'].includes(job.source?.type);
      const isSpotify = job.source?.type === 'spotify';

      if (isYt || isSpotify) {
        let downloadTarget = job.source.url;
        if (isSpotify) {
          // Resolve to official studio audio track on YouTube Music (avoids video clips/visualizers)
          const officialUrl = await resolveOfficialTrack(
            job.title,
            job.artist,
            job.duration || job.source.duration || 0,
          );
          if (officialUrl) {
            downloadTarget = officialUrl;
          } else if (!downloadTarget || !downloadTarget.startsWith('http')) {
            const q = job.source.query || `${job.title} ${job.artist}`.trim();
            downloadTarget = `ytsearch1:${q} Audio`;
          }
        }
        job.src = await ytDownload(job, downloadTarget, dest);
      } else {
        await downloadDirect(job, job.source.url, dest);
        job.src = dest;
      }
    }
    if (job.canceled) throw new Error('Canceled');
    job.status = 'analyzing';
    job.progress = 0;
    job.origSize = sizeOf(job.src);
    if (job.origSize > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES / 1048576} MB limit`);
    const info = await probe(job.src);
    job.duration = info.dur;
    if (job.source?.type === 'spotify') {
      job.title = job.title || info.tags.title || stripExt(job.filename);
      job.artist = job.artist || info.tags.artist || '';
    } else {
      job.title = info.tags.title || job.title || stripExt(job.filename);
      job.artist = info.tags.artist || job.artist || '';
    }
    job.srcInfo = `${info.codec.toUpperCase()}${info.br ? ' ' + info.br + ' kbps' : ''}`;
    job.status = 'processing';
    job.progress = 0;
    job.out = await encode(job, job.src, info);
    await settleTags(job);
    job.newSize = sizeOf(job.out);
    job.outName = `${safeName(stripExt(job.filename))}.${FORMATS[job.opts.format].ext}`;
    if (!job.newSize) throw new Error('Encoding produced an empty file');
    rm(job.src);
    job.src = null;
    job.hosted = job.opts.host;
    job.progress = 100;
    job.status = 'done';
  } catch (e) {
    job.status = job.canceled ? 'canceled' : 'error';
    job.error = job.canceled ? '' : String(e.message || e).slice(0, 300);
    rm(job.out);
    job.out = null;
    if (job.source) {
      rm(job.src);
      job.src = null;
    }
  } finally {
    job.proc = null;
    job.abort = null;
    job.finished = now();
    persistJobs();
  }
}
export function dispose(j) {
  j.canceled = true;
  j.proc?.kill('SIGKILL');
  j.abort?.abort();
  rm(j.src);
  rm(j.out);
  for (const n of fs.readdirSync(WORK)) if (n.startsWith(j.id)) rm(path.join(WORK, n));
  jobs.delete(j.id);
  persistJobs();
}
export function sweep() {
  const t = now();
  for (const j of [...jobs.values()]) {
    const base = j.finished || j.created;
    if (t - base > TTL_MS || (!j.finished && t - j.created > TTL_MS * 2)) dispose(j);
  }
  const live = new Set([...jobs.keys()]);
  for (const n of fs.readdirSync(WORK)) {
    const f = path.join(WORK, n);
    try {
      if (!live.has(n.slice(0, 36)) && t - fs.statSync(f).mtimeMs > 10 * 60_000) rm(f);
    } catch {}
  }
}
setInterval(sweep, Math.min(60_000, Math.max(1000, TTL_MS / 2))).unref();

export const pub = (j) => ({
  tags: j.tags || emptyTags(),
  id: j.id,
  status: j.status,
  progress: j.progress,
  title: j.title || stripExt(j.filename),
  artist: j.artist || '',
  cover: j.cover || j.source?.cover || '',
  filename: j.outName || j.filename,
  duration: j.duration,
  origSize: j.origSize,
  newSize: j.newSize,
  format: j.opts.format,
  note: j.note,
  error: j.error,
  hosted: j.hosted,
  srcInfo: j.srcInfo || '',
  expiresAt: (j.finished || j.created) + TTL_MS,
});
