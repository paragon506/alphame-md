import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from './config.js';
import { rm } from './utils.js';

const FIELDS = ['title', 'artist', 'album', 'year', 'genre'];
const MAX_LENGTH = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const TOPIC_SUFFIX = /\s*[-–—]\s*Topic$/i;

export const emptyTags = () => ({ title: '', artist: '', album: '', year: '', genre: '' });

export function readTags(raw = {}) {
  const date = String(raw.date || raw.year || '');
  return {
    title: raw.title || '',
    artist: raw.artist || '',
    album: raw.album || '',
    year: (date.match(/\d{4}/) || [''])[0],
    genre: raw.genre || '',
  };
}

export const cleanArtist = (artist) => artist.replace(TOPIC_SUFFIX, '').trim();

export function sanitizeTags(input = {}) {
  const tags = {};
  for (const field of FIELDS) {
    if (typeof input[field] !== 'string') continue;
    tags[field] = input[field].replace(CONTROL_CHARACTERS, ' ').trim().slice(0, MAX_LENGTH);
  }
  if (tags.year && !/^\d{4}$/.test(tags.year)) throw new Error('Year must have 4 digits');
  return tags;
}

export function rewriteTags(file, tags) {
  const extension = path.extname(file);
  const staging = path.join(WORK, `${path.basename(file, extension)}.tagging${extension}`);
  const metadata = Object.entries(tags).flatMap(([key, value]) => [
    '-metadata',
    `${key === 'year' ? 'date' : key}=${value}`,
  ]);
  const args = [
    ...['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file],
    ...['-map', '0', '-c', 'copy', '-map_metadata', '0'],
    ...metadata,
    ...(extension === '.mp3' ? ['-id3v2_version', '3'] : []),
    staging,
  ];

  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (error) => {
      if (error) {
        rm(staging);
        return reject(new Error('Could not update the tags'));
      }
      fs.renameSync(staging, file);
      resolve();
    });
  });
}
