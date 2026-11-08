import dns from 'node:dns/promises';
import net from 'node:net';
import { ALLOW_PRIVATE } from './config.js';

export function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const l = ip.toLowerCase();
  return (
    l === '::1' ||
    l === '::' ||
    l.startsWith('fc') ||
    l.startsWith('fd') ||
    l.startsWith('fe80') ||
    (l.startsWith('::ffff:') && isPrivate(l.slice(7)))
  );
}
export async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are supported');
  if (ALLOW_PRIVATE) return;
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address)))
    throw new Error('That address is not allowed');
}
export async function safeFetch(url, init = {}) {
  let u = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(u);
    const r = await fetch(u, { ...init, redirect: 'manual' });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      u = new URL(loc, u);
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects');
}
