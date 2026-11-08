import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORK, FORMATS, PROFILES, STD_BR } from './config.js';
import { rm, sizeOf } from './utils.js';

export const probe = (file) =>
  new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { maxBuffer: 16e6 },
      (e, out) => {
        if (e) return reject(new Error('Not a valid audio file'));
        try {
          const j = JSON.parse(out);
          const a = (j.streams || []).find((s) => s.codec_type === 'audio');
          if (!a) return reject(new Error('No audio stream found'));
          const tags = {};
          for (const [k, v] of Object.entries({ ...(a.tags || {}), ...(j.format?.tags || {}) }))
            tags[k.toLowerCase()] = v;
          resolve({
            codec: a.codec_name,
            br: Math.round((+a.bit_rate || +j.format.bit_rate || 0) / 1000),
            sr: +a.sample_rate || 0,
            ch: a.channels || 0,
            dur: +j.format.duration || +a.duration || 0,
            tags,
            cover: (j.streams || []).some(
              (s) => s.codec_type === 'video' && s.disposition?.attached_pic,
            ),
          });
        } catch {
          reject(new Error('Could not analyze file'));
        }
      },
    );
  });
export const LOSSY = new Set(['mp3', 'aac', 'opus', 'vorbis', 'wmav2', 'wmav1']);
export const vbrQ = (br, table) => (table.find(([min]) => br >= min) || [0, table.at(-1)[1]])[1];

export function normalizeOpts(o = {}) {
  const base = PROFILES[o.profile] || {};
  const m = { format: 'mp3', bitrate: 192, vbr: false, sampleRate: 0, channels: 0, ...base };
  if (o.profile === 'custom' || !PROFILES[o.profile]) {
    if (FORMATS[o.format]) m.format = o.format;
    const rawBr = +o.bitrate;
    m.bitrate = Number.isFinite(rawBr) ? Math.max(128, Math.min(320, rawBr)) : 192;
    m.vbr = !!o.vbr;
    m.sampleRate = [0, 22050, 32000, 44100, 48000].includes(+o.sampleRate) ? +o.sampleRate : 0;
    m.channels = [0, 1, 2].includes(+o.channels) ? +o.channels : 0;
  }
  m.sampleRate = m.sampleRate || 0;
  m.channels = m.channels || 0;
  return { ...m, host: !!o.host, profile: PROFILES[o.profile] ? o.profile : 'custom' };
}

export function runFfmpeg(job, args, dur) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    job.proc = p;
    let err = '',
      buf = '';
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-2000);
    });
    p.stdout.on('data', (d) => {
      buf += d;
      const m = [...buf.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
      buf = buf.slice(-200);
      if (m && dur) job.progress = Math.min(99, Math.round((+m[1] / 1e6 / dur) * 100));
    });
    p.on('error', () => reject(new Error('FFmpeg is not available')));
    p.on('close', (c) => {
      job.proc = null;
      c === 0
        ? resolve()
        : reject(
            new Error(
              job.canceled
                ? 'Canceled'
                : 'Encoding failed: ' + err.split('\n').filter(Boolean).pop(),
            ),
          );
    });
  });
}
export function autoTarget(info) {
  if (!LOSSY.has(info.codec)) return { format: 'mp3', bitrate: 192, vbr: true };
  const b = info.br || 192;
  const t = b >= 300 ? 192 : b >= 224 ? 160 : 128;
  return {
    format: 'mp3',
    bitrate: Math.min(t, 320),
    vbr: false,
    keep: info.codec === 'mp3' && b <= 128,
  };
}

export async function encode(job, src, info) {
  const o = job.opts.auto ? { ...job.opts, ...autoTarget(info) } : job.opts,
    fm = FORMATS[o.format];
  const out = path.join(WORK, `${job.id}.out.${fm.ext}`);
  const lossySrc = LOSSY.has(info.codec);
  let br = Math.max(o.bitrate, 128);
  if (lossySrc && info.br)
    br = Math.max(128, Math.min(br, STD_BR.find((s) => s <= info.br + 8) || STD_BR.at(-1)));
  const sameCodec = info.codec === 'mp3' && o.format === 'mp3';
  const alreadyOk =
    sameCodec &&
    info.br &&
    (o.keep || info.br <= br + 8) &&
    !(o.vbr && info.br > 256) &&
    (!o.sampleRate || o.sampleRate === info.sr) &&
    (!o.channels || o.channels === info.ch);
  if (alreadyOk) {
    fs.copyFileSync(src, out);
    job.note = 'Already within target, original kept';
    return out;
  }

  if (job.opts.auto) job.note = o.vbr ? 'Auto · high-quality VBR' : `Auto · ${br} kbps`;

  const build = (withCover) => {
    const a = ['-y', '-hide_banner', '-nostdin', '-i', src, '-map', '0:a:0'];
    if (withCover) a.push('-map', '0:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic');
    a.push('-map_metadata', '0');
    if (o.format === 'mp3') {
      a.push(
        '-c:a',
        'libmp3lame',
        ...(o.vbr
          ? [
              '-q:a',
              String(
                vbrQ(br, [
                  [256, 0],
                  [192, 2],
                  [160, 3],
                  [128, 4],
                  [96, 7],
                ]) ?? 9,
              ),
            ]
          : ['-b:a', br + 'k']),
        '-id3v2_version',
        '3',
      );
    } else if (o.format === 'm4a')
      a.push('-c:a', 'aac', '-b:a', br + 'k', '-movflags', '+faststart');
    else if (o.format === 'opus')
      a.push('-c:a', 'libopus', '-b:a', Math.min(br, 256) + 'k', '-vbr', o.vbr ? 'on' : 'off');
    else
      a.push(
        '-c:a',
        'libvorbis',
        ...(o.vbr
          ? [
              '-q:a',
              String(
                vbrQ(br, [
                  [256, 8],
                  [192, 6],
                  [160, 5],
                  [128, 4],
                  [96, 2],
                ]) ?? 0,
              ),
            ]
          : ['-b:a', br + 'k']),
      );
    if (o.sampleRate) a.push('-ar', String(o.sampleRate));
    if (o.channels) a.push('-ac', String(o.channels));
    a.push('-progress', 'pipe:1', '-nostats', out);
    return a;
  };
  const coverOk = info.cover && ['mp3', 'm4a'].includes(o.format);
  try {
    await runFfmpeg(job, build(coverOk), info.dur);
  } catch (e) {
    if (job.canceled || !coverOk) throw e;
    rm(out);
    await runFfmpeg(job, build(false), info.dur);
  }
  if (sameCodec && sizeOf(out) >= job.origSize) {
    fs.copyFileSync(src, out);
    job.note = 'Re-encoding would not save space, original kept';
  }
  return out;
}
