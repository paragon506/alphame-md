import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORT,
  WORK,
  TTL_MS,
  MAX_BYTES,
  CONCURRENCY,
  MAX_PLAYLIST,
  YTDLP,
  CORS_ORIGIN,
  PUBLIC_URL,
  AUDIO_EXT,
  FORMATS,
} from './config.js';
import { now, id, rm, safeName, stripExt } from './utils.js';
import { safeFetch } from './net.js';
import { normalizeOpts } from './media.js';
import { ytList } from './sources.js';
import { jobs, newJob, requeue, dispose, pub, stats, updateTags } from './jobs.js';
import { fetchPlaylist, normalizeTrack } from './playlist_adapter.js';
import { isSpotifyPlaylistUrl } from './spotify_reader.js';
import { searchYouTubeMusic } from './ytmusic_resolver.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
fs.mkdirSync(WORK, { recursive: true });

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (CORS_ORIGIN && req.path.startsWith('/api')) {
    res.set({
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'content-type,x-client-id',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
const base = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const clientOf = (req) => {
  const c = String(req.get('x-client-id') || req.query.c || '');
  return /^[\w-]{8,64}$/.test(c) ? c : null;
};
const need = (req, res, next) => {
  req.client = clientOf(req);
  req.client ? next() : res.status(400).json({ error: 'Missing client id' });
};
const mine = (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.client !== req.client) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return j;
};
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(400).json({ error: String(e.message || e) }),
  );

let ytAvailable = false;
execFile(YTDLP, ['--version'], (e) => {
  ytAvailable = !e;
});
let ffVersion = '';
execFile('ffmpeg', ['-version'], (e, o) => {
  ffVersion = e ? '' : String(o).split('\n')[0].split(' ')[2];
});

app.get('/health', (_q, res) =>
  res.json({
    ok: true,
    ffmpeg: !!ffVersion,
    ytdlp: ytAvailable,
    ...stats(),
    uptime: Math.round(process.uptime()),
  }),
);
app.get('/api/info', (_q, res) =>
  res.json({
    maxFileMB: MAX_BYTES / 1048576,
    ttlMinutes: TTL_MS / 60000,
    ytdlp: ytAvailable,
    concurrency: CONCURRENCY,
  }),
);

const upload = multer({
  storage: multer.diskStorage({
    destination: WORK,
    filename: (_q, _f, cb) => cb(null, id() + '.upload'),
  }),
  limits: { fileSize: MAX_BYTES, files: 50 },
  fileFilter: (_q, f, cb) =>
    cb(
      null,
      AUDIO_EXT.has(path.extname(f.originalname).toLowerCase()) || f.mimetype.startsWith('audio/'),
    ),
});
app.post(
  '/api/upload',
  need,
  upload.array('files', 50),
  wrap((req, res) => {
    const opts = normalizeOpts(JSON.parse(req.body.opts || '{}'));
    if (!req.files?.length) throw new Error('No supported audio files received');
    const out = req.files.map((f) => {
      const name = safeName(Buffer.from(f.originalname, 'latin1').toString('utf8'));
      return pub(
        newJob(req.client, {
          opts,
          filename: name,
          title: stripExt(name),
          src: f.path,
          origSize: f.size,
        }),
      );
    });
    res.json({ jobs: out });
  }),
);

app.post(
  '/api/playlist',
  need,
  wrap(async (req, res) => {
    const url = String(req.body.url || '').trim();
    if (!url) throw new Error('A playlist URL is required');
    const playlist = await fetchPlaylist(url);
    res.json({ playlist });
  }),
);

app.get(
  '/api/playlist',
  need,
  wrap(async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!url) throw new Error('A playlist URL is required');
    const playlist = await fetchPlaylist(url);
    res.json({ playlist });
  }),
);

app.get(
  '/api/search',
  need,
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });
    const results = await searchYouTubeMusic(q);
    res.json({ results });
  }),
);

app.post(
  '/api/import',
  need,
  wrap(async (req, res) => {
    const opts = normalizeOpts(req.body.opts);

    if (req.body.track) {
      const t = normalizeTrack(req.body.track);
      const query = t.query || `${t.title} ${t.artist}`.trim();
      const fname = safeName(t.artist ? `${t.artist} - ${t.title}` : t.title);
      const isYtDirect = t.source === 'youtube' && t.url && !t.url.startsWith('ytsearch');
      const targetUrl = isYtDirect ? t.url : `ytsearch1:${query}`;
      const job = pub(
        newJob(req.client, {
          opts,
          filename: fname,
          title: t.title,
          artist: t.artist,
          duration: t.duration || 0,
          cover: t.cover,
          source: {
            type: t.source,
            url: targetUrl,
            query,
            duration: t.duration || 0,
            cover: t.cover,
          },
        }),
      );
      return res.json({ jobs: [job], problems: [] });
    }

    if (Array.isArray(req.body.tracks) && req.body.tracks.length) {
      const created = [];
      const batchList = MAX_PLAYLIST > 0 ? req.body.tracks.slice(0, MAX_PLAYLIST) : req.body.tracks;
      for (const rawTrack of batchList) {
        const t = normalizeTrack(rawTrack);
        const query = t.query || `${t.title} ${t.artist}`.trim();
        const fname = safeName(t.artist ? `${t.artist} - ${t.title}` : t.title);
        const isYtDirect = t.source === 'youtube' && t.url && !t.url.startsWith('ytsearch');
        const targetUrl = isYtDirect ? t.url : `ytsearch1:${query}`;
        created.push(
          pub(
            newJob(req.client, {
              opts,
              filename: fname,
              title: t.title,
              artist: t.artist,
              duration: t.duration || 0,
              cover: t.cover,
              source: {
                type: t.source,
                url: targetUrl,
                query,
                duration: t.duration || 0,
                cover: t.cover,
              },
            }),
          ),
        );
      }
      return res.json({ jobs: created, problems: [] });
    }

    const text = String(req.body.text || '').slice(0, 200_000);
    const urls = [...new Set(text.split(/[\s,]+/).filter((s) => /^https?:\/\//i.test(s)))].slice(
      0,
      200,
    );
    if (!urls.length) throw new Error('Paste at least one http(s) link');
    const items = [],
      problems = [];
    for (const raw of urls) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      const h = u.hostname.replace(/^www\./, '');
      try {
        if (isSpotifyPlaylistUrl(raw)) {
          const sp = await fetchPlaylist(raw);
          for (const t of sp.tracks) {
            items.push({
              title: t.title,
              artist: t.artist,
              duration: t.duration || 0,
              cover: t.cover,
              type: 'spotify',
              query: t.query,
              url: `ytsearch1:${t.query}`,
            });
          }
        } else if (/(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com)$/.test(h)) {
          items.push(...(await ytList(raw)).map((x) => ({ ...x, type: 'yt' })));
        } else if (/\.m3u8?$/i.test(u.pathname)) {
          const r = await safeFetch(raw);
          const body = (await r.text()).slice(0, 500_000);
          const base = new URL(raw);
          for (const l of body.split(/\r?\n/)) {
            const s = l.trim();
            if (!s || s.startsWith('#')) continue;
            try {
              items.push({ url: new URL(s, base).href, type: 'direct' });
            } catch {}
          }
        } else items.push({ url: raw, type: 'direct' });
      } catch (e) {
        problems.push(`${raw.slice(0, 60)}: ${e.message}`);
      }
    }
    const created = [];
    const importList = MAX_PLAYLIST > 0 ? items.slice(0, MAX_PLAYLIST) : items;
    for (const it of importList) {
      let name = 'audio';
      try {
        name = decodeURIComponent(path.basename(new URL(it.url).pathname)) || 'audio';
      } catch {}
      const fname = safeName(
        it.type === 'spotify'
          ? it.artist
            ? `${it.artist} - ${it.title}`
            : it.title
          : it.type === 'yt'
            ? it.title || 'youtube-audio'
            : name,
      );
      created.push(
        pub(
          newJob(req.client, {
            opts,
            filename: fname,
            title: it.title || stripExt(fname),
            artist: it.artist || '',
            duration: it.duration || 0,
            cover: it.cover || '',
            source: {
              type: it.type,
              url: it.url,
              query: it.query || '',
              duration: it.duration || 0,
              cover: it.cover || '',
            },
          }),
        ),
      );
    }
    if (!created.length && problems.length) throw new Error(problems[0]);
    res.json({ jobs: created, problems });
  }),
);

app.get('/api/jobs', need, (req, res) =>
  res.json({
    jobs: [...jobs.values()].filter((j) => j.client === req.client).map(pub),
    serverTime: now(),
  }),
);
app.post('/api/jobs/:id/cancel', need, (req, res) => {
  const j = mine(req, res);
  if (!j) return;
  if (['queued', 'downloading', 'analyzing', 'processing'].includes(j.status)) {
    j.canceled = true;
    j.proc?.kill('SIGKILL');
    j.abort?.abort();
    if (j.status === 'queued') {
      j.status = 'canceled';
      j.finished = now();
      rm(j.src);
      j.src = null;
    }
  }
  res.json(pub(j));
});
app.post(
  '/api/jobs/:id/retry',
  need,
  wrap((req, res) => {
    const j = mine(req, res);
    if (!j) return;
    if (j.status !== 'error' && j.status !== 'canceled')
      throw new Error('Only failed jobs can be retried');
    if (!j.source && !j.src) throw new Error('The original upload is gone. Add the file again');
    Object.assign(j, {
      status: 'queued',
      progress: 0,
      error: '',
      canceled: false,
      finished: 0,
      created: now(),
      note: '',
    });
    requeue(j);
    res.json(pub(j));
  }),
);
app.post(
  '/api/jobs/:id/recompress',
  need,
  wrap(async (req, res) => {
    const j = mine(req, res);
    if (!j) return;
    if (j.status !== 'done') throw new Error('Only finished jobs can be recompressed');

    const newOpts = normalizeOpts(req.body.opts || j.opts);
    j.opts = newOpts;

    if (j.source) {
      rm(j.out);
      j.out = null;
      rm(j.src);
      j.src = null;
    } else if (j.out && fs.existsSync(j.out)) {
      const dest = path.join(WORK, `${j.id}.src`);
      rm(dest);
      fs.copyFileSync(j.out, dest);
      rm(j.out);
      j.out = null;
      j.src = dest;
    } else {
      throw new Error('Original audio is no longer available on the server');
    }

    Object.assign(j, {
      status: 'queued',
      progress: 0,
      newSize: 0,
      error: '',
      canceled: false,
      finished: 0,
      created: now(),
      note: '',
    });
    requeue(j);
    res.json(pub(j));
  }),
);
app.post(
  '/api/jobs/:id/tags',
  need,
  wrap(async (req, res) => {
    const job = mine(req, res);
    if (!job) return;
    await updateTags(job, req.body);
    res.json(pub(job));
  }),
);

app.post('/api/jobs/:id/host', need, (req, res) => {
  const j = mine(req, res);
  if (!j) return;
  if (j.status !== 'done') return res.status(400).json({ error: 'Not ready' });
  j.hosted = !!req.body.on;
  res.json(pub(j));
});
app.delete('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j) dispose(j);
  res.json({ ok: true });
});
app.post('/api/clear', (req, res) => {
  const reqClient = clientOf(req);
  for (const j of [...jobs.values()]) {
    if (!reqClient || j.client === reqClient || ['done', 'error', 'canceled'].includes(j.status)) {
      if (['done', 'error', 'canceled'].includes(j.status)) dispose(j);
    }
  }
  res.json({ ok: true });
});

app.get('/api/jobs/:id/audio', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done' || !j.out || !fs.existsSync(j.out)) {
    return res.status(404).end();
  }
  const ext = path.extname(j.out).replace(/^\./, '').toLowerCase();
  const mime = FORMATS[ext]?.mime || FORMATS[j.opts?.format]?.mime || 'audio/mpeg';
  res.type(mime);
  res.sendFile(path.resolve(j.out), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
app.get('/api/jobs/:id/download', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done' || !j.out || !fs.existsSync(j.out)) {
    return res.status(404).send('File not found');
  }
  res.download(path.resolve(j.out), j.outName || j.filename, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});
app.get('/api/zip', need, (req, res) => {
  const want = new Set(
    String(req.query.ids || '')
      .split(',')
      .filter(Boolean),
  );
  const list = [...jobs.values()].filter(
    (j) => j.client === req.client && j.status === 'done' && (!want.size || want.has(j.id)),
  );
  if (!list.length) return res.status(404).json({ error: 'Nothing to zip' });
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="AlphaMe.zip"',
  });
  const z = archiver('zip', { store: true });
  z.on('error', () => res.destroy());
  res.on('close', () => z.abort());
  z.pipe(res);
  const used = new Set();
  for (const j of list) {
    let n = j.outName,
      i = 2;
    while (used.has(n.toLowerCase())) n = j.outName.replace(/(\.\w+)$/, ` (${i++})$1`);
    used.add(n.toLowerCase());
    z.file(j.out, { name: n });
  }
  z.finalize();
});
app.get('/f/:id/:name?', (req, res) => {
  const j = jobs.get(req.params.id);
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!j || !j.hosted || j.status !== 'done')
    return res.status(404).type('text').send('This link has expired or was never shared.');
  res.set('Cache-Control', 'public, max-age=300');
  res.type(mimeOf(j));
  res.sendFile(j.out);
});
app.get('/api/jobs/:id/link', need, (req, res) => {
  const j = mine(req, res);
  if (!j || !j.hosted) return res.status(404).end();
  res.json({ url: `${base(req)}/f/${j.id}/${encodeURIComponent(j.outName)}` });
});

app.use(express.static(publicDir, { maxAge: '5m' }));

const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`AlphaMe listening on :${PORT} (work dir ${WORK})`),
);
server.requestTimeout = 0;
const shutdown = () => {
  for (const j of jobs.values()) {
    j.proc?.kill('SIGKILL');
  }
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
