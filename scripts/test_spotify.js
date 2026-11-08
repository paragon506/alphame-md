import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  isSpotifyPlaylistUrl,
  extractSpotifyPlaylistId,
  fetchSpotifyPlaylist,
} from '../src/spotify_reader.js';
import {
  detectPlaylistSource,
  normalizeTrack,
  normalizePlaylist,
  fetchPlaylist,
} from '../src/playlist_adapter.js';

const PUBLIC_SPOTIFY_PLAYLIST = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const NONEXISTENT_PLAYLIST = 'https://open.spotify.com/playlist/0000000000000000000000';

async function runTests() {
  console.log('Running Spotify integration tests…');

  // Test 1: URL detection and extraction
  console.log('  Testing URL detection & ID extraction…');
  assert.equal(isSpotifyPlaylistUrl(PUBLIC_SPOTIFY_PLAYLIST), true);
  assert.equal(
    isSpotifyPlaylistUrl('https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=123'),
    true,
  );
  assert.equal(isSpotifyPlaylistUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), true);
  assert.equal(isSpotifyPlaylistUrl('https://youtube.com/playlist?list=123'), false);
  assert.equal(isSpotifyPlaylistUrl('https://open.spotify.com/track/123'), false);

  assert.equal(extractSpotifyPlaylistId(PUBLIC_SPOTIFY_PLAYLIST), '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(
    extractSpotifyPlaylistId(
      'https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    ),
    '37i9dQZF1DXcBWIGoYBM5M',
  );
  console.log('  ✓ URL detection and ID extraction passed');

  // Test 2: Source detection
  console.log('  Testing source detection…');
  assert.equal(detectPlaylistSource(PUBLIC_SPOTIFY_PLAYLIST), 'spotify');
  assert.equal(detectPlaylistSource('https://www.youtube.com/playlist?list=PL12345'), 'youtube');
  assert.equal(detectPlaylistSource('https://example.com/audio.mp3'), null);
  console.log('  ✓ Source detection passed');

  // Test 3: Normalization
  console.log('  Testing track normalization…');
  const normalized = normalizeTrack(
    {
      name: 'Yellow',
      artists: ['Coldplay'],
      images: [{ url: 'https://example.com/cover.jpg' }],
      duration_ms: 269000,
      id: 'yellow-id',
    },
    'spotify',
  );

  assert.equal(normalized.title, 'Yellow');
  assert.equal(normalized.artist, 'Coldplay');
  assert.equal(normalized.duration, 269);
  assert.equal(normalized.source, 'spotify');
  assert.equal(normalized.query, 'Yellow Coldplay');
  assert.ok('cover' in normalized);
  console.log('  ✓ Track normalization passed');

  // Test 4: Live Spotify scraper fetch (read-only public playlist)
  console.log('  Testing live Spotify playlist fetch via spotifyscraper…');
  const playlist = await fetchPlaylist(PUBLIC_SPOTIFY_PLAYLIST, { maxTracks: 3 });
  assert.ok(playlist.title, 'Playlist should have a title');
  assert.equal(playlist.source, 'spotify');
  assert.ok(Array.isArray(playlist.tracks), 'Tracks should be an array');
  assert.ok(playlist.tracks.length > 0, 'Should have fetched at least 1 track');

  const firstTrack = playlist.tracks[0];
  assert.ok(firstTrack.title, 'First track must have title');
  assert.ok(firstTrack.artist, 'First track must have artist');
  assert.ok(typeof firstTrack.duration === 'number', 'Duration must be a number');
  assert.equal(firstTrack.source, 'spotify');
  assert.ok(firstTrack.query.includes(firstTrack.title), 'Query must include title');
  console.log(
    `  ✓ Successfully read Spotify playlist "${playlist.title}" with ${playlist.tracks.length} tracks`,
  );

  // Test 5: Error handling - non-existent playlist
  console.log('  Testing error handling on unavailable playlist…');
  await assert.rejects(
    () => fetchSpotifyPlaylist(NONEXISTENT_PLAYLIST),
    /not found|private|unavailable/i,
  );
  console.log('  ✓ Correctly rejected unavailable playlist with descriptive message');

  // Test 6: Error handling - invalid URL
  console.log('  Testing error handling on invalid URL…');
  await assert.rejects(
    () => fetchSpotifyPlaylist('https://open.spotify.com/invalid/url'),
    /Invalid Spotify playlist URL/i,
  );
  console.log('  ✓ Correctly rejected invalid URL');

  // Test 7: HTTP API Endpoints
  console.log('  Testing HTTP API endpoints (/api/playlist and /api/import)…');
  const port = 3088;
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(port), WORK_DIR: 'test_work_spotify' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const clientId = 'test-spotify-client-123';

  try {
    // Wait for server to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timed out')), 10000);
      child.stdout.on('data', (d) => {
        if (d.toString().includes('AlphaMe listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on('error', reject);
    });

    // POST /api/playlist
    const resPlaylist = await fetch(`${baseUrl}/api/playlist`, {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: PUBLIC_SPOTIFY_PLAYLIST }),
    });
    assert.equal(resPlaylist.status, 200);
    const jsonPlaylist = await resPlaylist.json();
    assert.ok(jsonPlaylist.playlist);
    assert.equal(jsonPlaylist.playlist.source, 'spotify');
    assert.ok(jsonPlaylist.playlist.tracks.length > 0);
    console.log(`  ✓ POST /api/playlist returned ${jsonPlaylist.playlist.tracks.length} tracks`);

    // POST /api/playlist error test
    const resErr = await fetch(`${baseUrl}/api/playlist`, {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: NONEXISTENT_PLAYLIST }),
    });
    assert.equal(resErr.status, 400);
    const jsonErr = await resErr.json();
    assert.ok(jsonErr.error);
    console.log(`  ✓ POST /api/playlist returned clean 400 error: "${jsonErr.error}"`);

    // POST /api/import with track download
    const sampleTrack = jsonPlaylist.playlist.tracks[0];
    const resImport = await fetch(`${baseUrl}/api/import`, {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        track: sampleTrack,
        opts: { format: 'mp3', bitrate: 192 },
      }),
    });
    assert.equal(resImport.status, 200);
    const jsonImport = await resImport.json();
    assert.equal(jsonImport.jobs.length, 1);
    assert.equal(jsonImport.jobs[0].title, sampleTrack.title);
    assert.equal(jsonImport.jobs[0].artist, sampleTrack.artist);
    console.log(`  ✓ POST /api/import queued track "${sampleTrack.title}" as YouTube search`);
  } finally {
    child.kill('SIGKILL');
  }

  console.log('\nAll Spotify integration tests passed successfully!');
}

runTests().catch((err) => {
  console.error('\nSpotify test failed:', err);
  process.exit(1);
});
