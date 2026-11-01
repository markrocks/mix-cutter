# Mix Cutter

Turn a full band-practice recording into numbered, tagged song files, then share them with the band on SoundCloud.

**Import → Cut up songs → Publish**

1. **Import**: drop in the recording (desktop or phone). Pick the band from your saved list (or add one), the date (defaults to today), and any notes. Choose **Stop for review** or **Do everything automatically**.
2. **Cut up songs**: Mix Cutter listens to the recording and finds each song (loud, sustained playing) between the talking (quieter, choppy). In review mode you get a waveform editor where you can drag song edges, play, rename, split, merge, skip or add songs, and re-detect with different sensitivity. **Save** writes 320 kbps MP3s with ID3 tags to:
   ```
   ~/Music/Mix Cutter/<Band>/<YYYY-MM-DD> - <Band> Practice/
     01 - Song 1 (0m23s).mp3        ← number, label, where it starts in the recording
     02 - Song 2 (12m40s).mp3
     Session Info.txt               ← band, date, notes, track list with timestamps
   ```
3. **Publish**: uploads each song to your SoundCloud account as a **private** track and groups them into a **private playlist** ("Band - Practice 2026-11-01"). You get a secret link to paste into the band chat.

## Run it

Requires Node 20.12+ and ffmpeg (`brew install ffmpeg`).

```bash
cd ~/Development/mix-cutter
npm install
npm start            # http://localhost:4317
```

### Upload from a phone
The server listens on your Wi-Fi network. Click **Phone upload** in the top bar and scan the QR code. The phone must be on the same Wi-Fi as the desktop. Files go straight to the desktop. Set `HOST=127.0.0.1` in `.env` to turn this off.

## SoundCloud setup (to do)

Edit `.env` (already created from `.env.example`):

```
SOUNDCLOUD_CLIENT_ID=...
SOUNDCLOUD_CLIENT_SECRET=...
SOUNDCLOUD_REDIRECT_URI=http://localhost:4317/auth/soundcloud/callback
```

- The redirect URI must **exactly** match the one registered on your app at soundcloud.com/you/apps.
- Restart `npm start`, open **Settings → Connect SoundCloud**, and sign in once. Tokens are stored in `data/soundcloud.json` and refresh automatically.
- `SOUNDCLOUD_DRY_RUN=1` simulates uploads, so you can try the whole flow without touching your account.
- Free SoundCloud accounts have a limited total upload time. Long practices may need SoundCloud Pro.

## How song detection works
`server/segment.js`. Per second of audio it measures loudness and a "low-energy ratio" (how often the sound drops toward silence; speech does, a band playing doesn't). It smooths both, automatically picks a threshold between "talk" and "music" (Otsu's method), bridges short gaps inside songs (breakdowns), drops anything shorter than the minimum song length, and pads each song so count-ins and ringing last chords are kept. Every knob is adjustable per session (Detection settings) or as defaults (Settings).

## Project layout
```
server/
  index.js       Express API + static UI
  pipeline.js    background steps: analyze → cut → upload (auto-chaining in automatic mode)
  analyze.js     one ffmpeg pass: features + waveform peaks + browser preview
  segment.js     song detection (pure, unit-tested)
  cutter.js      ffmpeg cutting, tagging, folder naming
  soundcloud.js  OAuth 2.1 + PKCE, track upload, playlist creation
  store.js       JSON storage: bands, settings, sessions (in data/)
public/          No-build frontend (ES modules): import, review editor, publish, settings
test/            npm test (detection unit tests), npm run fixture (builds a fake practice recording)
```

Working data (uploads, analysis, previews) lives in `data/`. Deleting a session in the app removes only that working copy; saved song folders and SoundCloud uploads are kept.

## Ideas for next iterations
- Fingerprint/compare songs across practices to suggest real song names ("this sounds like *Song A* from last week")
- Set-list field on import to auto-name songs in order
- Package as a menu-bar / Electron app; optional cloud relay so phones can upload from anywhere
- Loudness-normalize each song (EBU R128) before export
