import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'web');
const output = path.join(root, 'public');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
fs.cpSync(path.join(source, 'js'), path.join(output, 'js'), { recursive: true });
for (const file of ['index.html', 'config.js']) {
  fs.copyFileSync(path.join(source, file), path.join(output, file));
}
console.log('Static files copied to public/');
