import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirs = ['src', path.join('web', 'js')].map((dir) => path.join(root, dir));

for (const dir of sourceDirs) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'inherit' });
  }
}

for (const binary of ['ffmpeg', 'ffprobe']) {
  try {
    execFileSync(binary, ['-version'], { stdio: 'ignore' });
  } catch {
    console.warn(`[warn] ${binary} not found in PATH (it is installed in the Docker image).`);
  }
}

console.log('AlphaMe build check OK');
