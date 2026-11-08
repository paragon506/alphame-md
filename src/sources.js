import { spawn, execFile } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import { WORK, MAX_BYTES, MAX_PLAYLIST, YTDLP } from './config.js';
import { safeFetch } from './net.js';

export async function downloadDirect(job, url, dest) {
  const ac = (job.abort = new AbortController());
  const r = await safeFetch(url, { signal: ac.signal, headers: { 'user-agent': 'AlphaMe/1.0' } });
  if (!r.ok || !r.body) throw new Error(`Download failed (HTTP ${r.status})`);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('text/') || ct.includes('html') || ct.includes('json'))
    throw new Error('That link is not a direct audio file');
  const len = +r.headers.get('content-length') || 0;
  if (len > MAX_BYTES) throw new Error(`File exceeds ${MAX_BYTES / 1048576} MB limit`);
  let got = 0;
  const counter = new Transform({
    transform(c, _, cb) {
      got += c.length;
      if (got > MAX_BYTES) return cb(new Error('File exceeds size limit'));
      if (len) job.progress = Math.round((got / len) * 100);
      cb(null, c);
    },
  });
  await pipeline(Readable.fromWeb(r.body), counter, fs.createWriteStream(dest));
  job.origSize = got;
}
export function getYtDlpCookieArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_PATH && fs.existsSync(process.env.YTDLP_COOKIES_PATH)) {
    args.push('--cookies', process.env.YTDLP_COOKIES_PATH);
  } else if (fs.existsSync('cookies.txt')) {
    args.push('--cookies', 'cookies.txt');
  } else if (process.env.YTDLP_COOKIES || process.env.YTDLP_COOKIES_BASE64) {
    const cookiePath = path.join(WORK, 'youtube_cookies.txt');
    try {
      if (!fs.existsSync(cookiePath)) {
        const content = process.env.YTDLP_COOKIES_BASE64
          ? Buffer.from(process.env.YTDLP_COOKIES_BASE64, 'base64').toString('utf8')
          : process.env.YTDLP_COOKIES;
        fs.writeFileSync(cookiePath, content, 'utf8');
      }
      args.push('--cookies', cookiePath);
    } catch {}
  }
  return args;
}

export function getYtDlpCommonArgs() {
  return [
    '--no-warnings',
    '--js-runtimes',
    'node',
    '--remote-components',
    'ejs:github',
    ...getYtDlpCookieArgs(),
  ];
}

export function ytList(url) {
  return new Promise((resolve, reject) => {
    const args = ['--flat-playlist', '-J', ...getYtDlpCommonArgs()];
    if (MAX_PLAYLIST > 0) {
      args.push('--playlist-end', String(MAX_PLAYLIST));
    }
    args.push(url);
    execFile(YTDLP, args, { maxBuffer: 64e6, timeout: 180_000 }, (e, out) => {
      if (e)
        return reject(
          new Error(
            e.code === 'ENOENT'
              ? 'yt-dlp is not installed on this server'
              : 'Could not read that link (private, removed or unavailable)',
          ),
        );
      try {
        const j = JSON.parse(out);
        const list = (j.entries || [j]).filter(Boolean).map((x) => ({
          title: x.title || x.id,
          url: /^https?:/.test(x.webpage_url || x.url || '')
            ? x.webpage_url || x.url
            : `https://www.youtube.com/watch?v=${x.id}`,
        }));
        resolve(list);
      } catch {
        reject(new Error('Unexpected response while reading that link'));
      }
    });
  });
}
export function ytDownload(job, url, base) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f',
      'ba/ba*/b',
      '--no-playlist',
      '--newline',
      '--max-filesize',
      `${Math.floor(MAX_BYTES / 1048576)}M`,
      '--extractor-args',
      'youtube:player_client=android,ios,mweb,web',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      ...getYtDlpCommonArgs(),
      '-o',
      base + '.%(ext)s',
      url,
    ];
    const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = p;
    let err = '';
    p.stdout.on('data', (d) => {
      const m = String(d).match(/(\d+(?:\.\d+)?)%/g);
      if (m) job.progress = Math.round(parseFloat(m.at(-1)));
    });
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-1200);
    });
    p.on('error', () => reject(new Error('yt-dlp is not installed on this server')));
    p.on('close', (c) => {
      job.proc = null;
      const f = fs
        .readdirSync(WORK)
        .find((n) => n.startsWith(path.basename(base) + '.') && !n.endsWith('.part'));
      if (c === 0 && f) return resolve(path.join(WORK, f));

      let msg = err.split('\n').filter(Boolean).pop() || 'unknown error';
      if (/sign in to confirm you/i.test(err)) {
        msg =
          'YouTube blocked this request with bot verification. Configure cookies (via cookies.txt or YTDLP_COOKIES variable) to bypass this check.';
      } else if (/Requested format is not available/i.test(err)) {
        msg =
          'YouTube did not provide audio streams for this link without authentication. Configure cookies (via cookies.txt or YTDLP_COOKIES_BASE64) to download it.';
      }
      reject(new Error(job.canceled ? 'Canceled' : 'Download failed: ' + msg));
    });
  });
}
