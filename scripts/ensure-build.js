import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!fs.existsSync(path.join(root, 'public', 'assets', 'styles.css'))) {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
