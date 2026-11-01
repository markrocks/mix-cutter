import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

export const PORT = Number(process.env.PORT || 4317);
export const HOST = process.env.HOST || '0.0.0.0';

export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const PUBLIC_DIR = path.join(ROOT, 'public');

export const DEFAULT_OUTPUT_DIR =
  process.env.OUTPUT_DIR || path.join(os.homedir(), 'Music', 'Mix Cutter');

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export const soundcloud = {
  clientId: process.env.SOUNDCLOUD_CLIENT_ID || '',
  clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET || '',
  redirectUri:
    process.env.SOUNDCLOUD_REDIRECT_URI || `http://localhost:${PORT}/auth/soundcloud/callback`,
  dryRun: process.env.SOUNDCLOUD_DRY_RUN === '1',
};

for (const dir of [DATA_DIR, UPLOAD_DIR, SESSIONS_DIR]) fs.mkdirSync(dir, { recursive: true });
