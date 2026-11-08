import fs from 'node:fs';
import crypto from 'node:crypto';

export const now = () => Date.now();
export const id = () => crypto.randomUUID();
export const rm = (f) => f && fs.rm(f, { force: true }, () => {});
export const sizeOf = (f) => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
};
export const safeName = (s) =>
  String(s || 'audio')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'audio';
export const stripExt = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, '');
