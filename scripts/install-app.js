// `npm run install-app`: adds a Mix Cutter app icon for this computer.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let result;

if (process.platform === 'darwin') {
  result = spawnSync('bash', [path.join(dir, 'install-mac.sh'), ...args], { stdio: 'inherit' });
} else if (process.platform === 'win32') {
  result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'install-windows.ps1')], { stdio: 'inherit' });
} else {
  console.log('No app installer for this platform yet. Run `npm start` and open http://localhost:4317.');
  process.exit(0);
}
process.exit(result.status ?? 1);
