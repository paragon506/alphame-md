import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const PORT = 3055,
  B = `http://127.0.0.1:${PORT}`,
  C = 'test-client-0001',
  H = { 'x-client-id': C };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-test-'));
const sh = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
sh('-f', 'lavfi', '-i', 'color=c=red:s=200x200', '-frames:v', '1', `${dir}/cover.jpg`);
sh(
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=20',
  '-i',
  `${dir}/cover.jpg`,
  '-map',
  '0',
  '-map',
  '1',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '320k',
  '-id3v2_version',
  '3',
  '-metadata',
  'title=Test Tone',
  '-metadata',
  'artist=Tester',
  '-disposition:v',
  'attached_pic',
  `${dir}/big.mp3`,
);
sh(
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=880:duration=10',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '64k',
  `${dir}/low.mp3`,
);
sh('-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-ac', '2', `${dir}/song.flac`);
sh(
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=500:duration=5',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '128k',
  '-metadata',
  'title=Song',
  '-metadata',
  'artist=Band - Topic',
  `${dir}/topic.mp3`,
);
fs.writeFileSync(`${dir}/list.m3u`, '#EXTM3U\nbig.mp3\nlow.mp3\n');
const files = http
  .createServer((q, r) => {
    const f = path.join(dir, path.basename(q.url));
    fs.existsSync(f)
      ? (r.setHeader(
          'content-type',
          f.endsWith('.m3u')
            ? 'audio/x-mpegurl'
            : f.endsWith('.mp3')
              ? 'audio/mpeg'
              : 'application/octet-stream',
        ),
        fs.createReadStream(f).pipe(r))
      : ((r.statusCode = 404), r.end());
  })
  .listen(3056);
const srv = spawn(process.execPath, ['src/server.js'], {
  env: {
    ...process.env,
    PORT,
    ALLOW_PRIVATE_URLS: 'true',
    TTL_MINUTES: '0.1',
    WORK_DIR: path.join(dir, 'work'),
  },
  stdio: 'inherit',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u, o = {}) => {
  const r = await fetch(B + u, {
    ...o,
    headers: {
      ...H,
      ...(o.body && typeof o.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
  return { r, j: await r.json().catch(() => ({})) };
};
const waitDone = async (n, ms = 60000) => {
  const t = Date.now();
  for (;;) {
    const { j } = await J('/api/jobs');
    if (
      j.jobs.length >= n &&
      j.jobs.every((x) => !['queued', 'downloading', 'analyzing', 'processing'].includes(x.status))
    )
      return j.jobs;
    assert(Date.now() - t < ms, 'timeout');
    await sleep(300);
  }
};
let ok = 0;
const pass = (m) => {
  ok++;
  console.log('  ✓', m);
};
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(B + '/health')).ok) break;
    } catch {}
    await sleep(250);
  }
  let h;
  for (let i = 0; i < 20; i++) {
    h = await (await fetch(B + '/health')).json();
    if (h.ffmpeg) break;
    await sleep(200);
  }
  assert(h.ok && h.ffmpeg);
  pass('health + ffmpeg detected');
  assert((await fetch(B + '/api/jobs')).status === 400);
  pass('client id required');
  for (const [url, type] of [
    ['/', 'text/html'],
    ['/assets/styles.css', 'text/css'],
    ['/js/main.js', 'javascript'],
  ]) {
    const res = await fetch(B + url);
    assert(res.ok && (res.headers.get('content-type') || '').includes(type), url);
  }
  pass('frontend served: html, css, es modules');

  const fd = new FormData();
  fd.append('opts', JSON.stringify({ profile: 'small', host: true }));
  for (const n of ['big.mp3', 'low.mp3', 'song.flac'])
    fd.append('files', new Blob([fs.readFileSync(`${dir}/${n}`)]), n);
  fd.append('files', new Blob(['nope']), 'notes.txt');
  let up = await J('/api/upload', { method: 'POST', body: fd });
  assert.equal(up.j.jobs.length, 3);
  pass('upload accepts 3 audio files, rejects .txt');
  let jobs = await waitDone(3);
  const by = (t) => jobs.find((j) => j.filename.startsWith(t));
  assert(
    jobs.every((j) => j.status === 'done'),
    JSON.stringify(jobs),
  );
  pass('all jobs completed');
  assert(by('big').newSize < by('big').origSize * 0.6);
  pass(`320k → 128k: ${by('big').origSize} → ${by('big').newSize} bytes`);
  assert.equal(by('big').title, 'Test Tone');
  pass('ID3 title read');
  {
    const song = by('song');
    const edited = await J(`/api/jobs/${song.id}/tags`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Edited Title',
        artist: 'Some Artist',
        album: 'Some Album',
        year: '2021',
        genre: 'Rock',
      }),
    });
    assert.equal(edited.r.status, 200);
    assert.equal(edited.j.filename, 'Some Artist - Edited Title.mp3');
    const file = `${dir}/edited.mp3`;
    fs.writeFileSync(
      file,
      Buffer.from(await (await fetch(`${B}/api/jobs/${song.id}/download?c=${C}`)).arrayBuffer()),
    );
    const tags = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', file]),
    ).format.tags;
    assert.deepEqual(
      [tags.title, tags.artist, tags.album, tags.date, tags.genre],
      ['Edited Title', 'Some Artist', 'Some Album', '2021', 'Rock'],
    );
    const invalid = await J(`/api/jobs/${song.id}/tags`, {
      method: 'POST',
      body: JSON.stringify({ year: '21' }),
    });
    assert.equal(invalid.r.status, 400);
    pass('tag editor: ID3 rewritten without re-encoding, filename updated, bad year rejected');
  }
  assert(by('low').note.includes('original kept') && by('low').newSize === by('low').origSize);
  pass('64k MP3 not re-encoded (kept)');
  assert(by('song').format === 'mp3' && by('song').newSize > 0);
  pass('FLAC → MP3');
  const dl = await fetch(`${B}/api/jobs/${by('big').id}/download?c=${C}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  fs.writeFileSync(`${dir}/out.mp3`, buf);
  const pr = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      `${dir}/out.mp3`,
    ]),
  );
  assert.equal(Math.round(pr.format.bit_rate / 1000 / 8) * 8 <= 136, true);
  assert(pr.streams.some((s) => s.codec_type === 'video') && pr.format.tags.title === 'Test Tone');
  pass('output is ~128k with cover + ID3 preserved');
  const zip = await fetch(`${B}/api/zip?c=${C}`);
  const zb = Buffer.from(await zip.arrayBuffer());
  assert(
    zb.subarray(0, 2).toString() === 'PK' && zip.headers.get('content-type') === 'application/zip',
  );
  pass(`ZIP generated (${zb.length} bytes)`);
  const link = (await J(`/api/jobs/${by('big').id}/link`)).j.url;
  assert(link.includes('/f/'));
  const rg = await fetch(link, { headers: { range: 'bytes=0-99' } });
  assert.equal(rg.status, 206);
  assert.equal(rg.headers.get('access-control-allow-origin'), '*');
  assert.equal(rg.headers.get('content-type'), 'audio/mpeg');
  pass('hosted link: 206 Range, CORS *, audio/mpeg');
  assert((await fetch(`${B}/f/${by('low').id}`)).status === 200);
  await J(`/api/jobs/${by('low').id}/host`, {
    method: 'POST',
    body: JSON.stringify({ on: false }),
  });
  assert((await fetch(`${B}/f/${by('low').id}`)).status === 404);
  pass('unsharing works');
  assert(
    (
      await fetch(`${B}/api/jobs/${by('big').id}/download`, {
        headers: { 'x-client-id': 'other-client-9999' },
      })
    ).status === 404,
  );
  pass('jobs isolated per client');

  await J('/api/clear', { method: 'POST' });
  let r = await J('/api/import', {
    method: 'POST',
    body: JSON.stringify({
      text: 'http://127.0.0.1:3056/big.mp3 http://127.0.0.1:3056/list.m3u',
      opts: { profile: 'custom', format: 'opus', bitrate: 128, vbr: true },
    }),
  });
  assert.equal(r.j.jobs.length, 3);
  jobs = await waitDone(3);
  assert(jobs.every((j) => j.status === 'done' && j.format === 'opus'));
  pass('URL + M3U import → Opus VBR');
  await J('/api/clear', { method: 'POST' });
  {
    const f = new FormData();
    f.append('opts', '{"profile":"auto"}');
    for (const n of ['big.mp3', 'low.mp3', 'song.flac'])
      f.append('files', new Blob([fs.readFileSync(`${dir}/${n}`)]), n);
    await J('/api/upload', { method: 'POST', body: f });
    const a = await waitDone(3);
    const g = (t) => a.find((j) => j.filename.startsWith(t));
    assert(g('big').note.startsWith('Auto') && g('big').newSize < g('big').origSize * 0.7);
    assert(g('low').newSize === g('low').origSize);
    assert(g('song').note.includes('VBR') && g('song').status === 'done');
    pass('Auto mode: 320k→192k, small MP3 kept, FLAC→VBR');
    await J('/api/clear', { method: 'POST' });
    {
      const f = new FormData();
      f.append('opts', '{"profile":"auto"}');
      f.append('files', new Blob([fs.readFileSync(`${dir}/topic.mp3`)]), 'topic.mp3');
      await J('/api/upload', { method: 'POST', body: f });
      const [cleaned] = await waitDone(1);
      assert.equal(cleaned.tags.artist, 'Band');
      assert.equal(cleaned.filename, 'topic.mp3');
      pass('"- Topic" suffix removed from artist');
    }
    await J('/api/clear', { method: 'POST' });
  }
  r = await J('/api/import', {
    method: 'POST',
    body: JSON.stringify({ text: 'http://127.0.0.1:3056/missing.mp3', opts: {} }),
  });
  jobs = await waitDone(1);
  assert(jobs[0].status === 'error');
  pass('bad URL → error status');
  const rt = await J(`/api/jobs/${jobs[0].id}/retry`, { method: 'POST' });
  assert(rt.r.status === 200);
  await waitDone(1);
  pass('retry accepted');
  await J('/api/clear', { method: 'POST' });
  sh(
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=1500',
    '-c:a',
    'pcm_s16le',
    `${dir}/long.wav`,
  );
  {
    const f = new FormData();
    f.append('opts', '{"profile":"best"}');
    f.append('files', new Blob([fs.readFileSync(`${dir}/long.wav`)]), 'long.wav');
    const u = await J('/api/upload', { method: 'POST', body: f });
    const id = u.j.jobs[0].id;
    await sleep(700);
    await J(`/api/jobs/${id}/cancel`, { method: 'POST' });
    jobs = await waitDone(1);
    assert.equal(jobs[0].status, 'canceled');
    pass('cancel kills a running encode');
  }
  await J('/api/clear', { method: 'POST' });
  const f3 = new FormData();
  f3.append('opts', '{}');
  f3.append('files', new Blob([fs.readFileSync(`${dir}/low.mp3`)]), 'expire.mp3');
  await J('/api/upload', { method: 'POST', body: f3 });
  await waitDone(1);
  const wd = path.join(dir, 'work');
  assert(fs.readdirSync(wd).length > 0);
  await sleep(9000);
  assert.equal((await J('/api/jobs')).j.jobs.length, 0);
  assert.equal(fs.readdirSync(wd).length, 0);
  pass('auto-cleanup removed jobs and files after TTL');
  console.log(`\nAll ${ok} checks passed`);
} catch (e) {
  console.error('\nFAILED:', e);
  process.exitCode = 1;
} finally {
  srv.kill();
  files.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
