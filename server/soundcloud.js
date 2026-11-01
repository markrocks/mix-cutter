/**
 * SoundCloud integration: OAuth 2.1 (authorization code + PKCE), track upload,
 * and playlist creation. Tokens are stored locally in data/soundcloud.json.
 *
 * Docs: https://developers.soundcloud.com/docs/api/guide
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, soundcloud as cfg } from './config.js';
import { readJson, writeJson } from './store.js';

const AUTH_URL = 'https://secure.soundcloud.com/authorize';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const API = 'https://api.soundcloud.com';
const TOKEN_FILE = path.join(DATA_DIR, 'soundcloud.json');

const pending = new Map(); // state -> { verifier, createdAt }

export const isConfigured = () => cfg.dryRun || Boolean(cfg.clientId && cfg.clientSecret);

export function status() {
  if (cfg.dryRun) return { configured: true, connected: true, dryRun: true, username: 'dry-run' };
  const tok = readJson(TOKEN_FILE, null);
  return {
    configured: isConfigured(),
    connected: Boolean(tok?.access_token),
    username: tok?.user?.username || null,
    permalinkUrl: tok?.user?.permalink_url || null,
    redirectUri: cfg.redirectUri,
    dryRun: false,
  };
}

export function authorizeUrl() {
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('SoundCloud is not configured. Add SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET to .env.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  pending.set(state, { verifier, createdAt: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 15 * 60_000) pending.delete(k);
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

export async function handleCallback({ code, state }) {
  const p = pending.get(state);
  if (!p) throw new Error('Sign-in expired or was started elsewhere. Please try connecting again.');
  pending.delete(state);
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    code_verifier: p.verifier,
    code,
  });
  saveToken(tok);
  try {
    const me = await api('GET', '/me');
    const saved = readJson(TOKEN_FILE, {});
    saved.user = { id: me.id, username: me.username, permalink_url: me.permalink_url };
    writeJson(TOKEN_FILE, saved);
  } catch {
    /* non-fatal */
  }
}

export function disconnect() {
  fs.rmSync(TOKEN_FILE, { force: true });
}

/* ---------------- uploads ---------------- */

export async function uploadTrack({ file, title, description, tags, sharing = 'private' }) {
  if (cfg.dryRun) {
    await new Promise((r) => setTimeout(r, 400));
    const id = Math.floor(Math.random() * 1e9);
    return { id, urn: `soundcloud:tracks:${id}`, permalink_url: `https://soundcloud.com/dry-run/track-${id}`, shareUrl: `https://soundcloud.com/dry-run/track-${id}/s-dryrun` };
  }
  const blob = await fs.openAsBlob(file, { type: 'audio/mpeg' });
  const makeBody = () => {
    const fd = new FormData();
    fd.append('track[title]', title);
    fd.append('track[sharing]', sharing);
    if (description) fd.append('track[description]', description);
    if (tags) fd.append('track[tag_list]', tags);
    fd.append('track[downloadable]', 'true');
    fd.append('track[asset_data]', blob, path.basename(file));
    return fd;
  };
  const t = await api('POST', '/tracks', makeBody);
  return { id: t.id, urn: t.urn || trackUrn(t), permalink_url: cleanShareUrl(t.permalink_url), shareUrl: shareUrl(t) };
}

/** SoundCloud identifies tracks by URN ("soundcloud:tracks:123"); ids exceed 32-bit ints. */
export const trackUrn = (t) => t.urn || `soundcloud:tracks:${t.id}`;

export async function createPlaylist({ title, description, trackUrns, sharing = 'private' }) {
  if (cfg.dryRun) {
    await new Promise((r) => setTimeout(r, 300));
    return { id: 1, permalink_url: 'https://soundcloud.com/dry-run/sets/practice', shareUrl: 'https://soundcloud.com/dry-run/sets/practice/s-dryrun' };
  }
  const body = JSON.stringify({
    playlist: { title, description, sharing, tracks: trackUrns.map((urn) => ({ urn })) },
  });
  const pl = await api('POST', '/playlists', () => body, { 'content-type': 'application/json' });
  return { id: pl.id, urn: pl.urn, permalink_url: cleanShareUrl(pl.permalink_url), shareUrl: shareUrl(pl) };
}

/**
 * Private items need their secret token ("/s-XXXX") in the URL to be shareable.
 * SoundCloud usually includes it in permalink_url already (plus ?utm_ tracking
 * params), so only append a token when the permalink lacks one.
 */
function shareUrl(item) {
  const base = cleanShareUrl(item.secret_permalink_url || item.permalink_url);
  if (!base || /\/s-[\w-]+$/.test(base)) return base;
  const token = item.secret_token || String(item.secret_uri || '').match(/secret_token=([^&]+)/)?.[1];
  return token && item.sharing === 'private' ? `${base}/${token}` : base;
}

/** Drop query/tracking params (and anything accidentally appended after them). */
export function cleanShareUrl(url) {
  return url ? String(url).split('?')[0].replace(/\/+$/, '') : url;
}

/* ---------------- plumbing ---------------- */

async function api(method, pathname, makeBody, headers = {}, retried = false) {
  const token = await accessToken();
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { accept: 'application/json; charset=utf-8', authorization: `OAuth ${token}`, ...headers },
    body: makeBody ? makeBody() : undefined,
  });
  if (res.status === 401 && !retried) {
    await refresh();
    return api(method, pathname, makeBody, headers, true);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`SoundCloud ${method} ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function accessToken() {
  const tok = readJson(TOKEN_FILE, null);
  if (!tok?.access_token) throw new Error('Not connected to SoundCloud. Click "Connect SoundCloud" first.');
  if (tok.expires_at && Date.now() > tok.expires_at - 60_000) return (await refresh()).access_token;
  return tok.access_token;
}

async function refresh() {
  const tok = readJson(TOKEN_FILE, null);
  if (!tok?.refresh_token) throw new Error('SoundCloud session expired. Please reconnect.');
  const next = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: tok.refresh_token,
  });
  return saveToken(next, tok.user);
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json; charset=utf-8' },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SoundCloud sign-in failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function saveToken(tok, user) {
  const saved = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    scope: tok.scope,
    expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null,
    user: user || readJson(TOKEN_FILE, {})?.user,
  };
  writeJson(TOKEN_FILE, saved);
  return saved;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
