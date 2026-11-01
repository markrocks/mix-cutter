# Mix Cutter

**Turn a full band-practice recording into separate, numbered song files and share them with your band on SoundCloud.**

You record the whole practice: talking, tuning, songs, more talking, more songs. Mix Cutter finds where each song starts and stops, cuts them out, saves them as tagged MP3s in a neatly named folder, and can upload them to SoundCloud as a private playlist the band can listen to with one link.

It runs on your computer and you use it in a web browser. You can also send recordings to it from your phone over Wi-Fi.

---

## What it does

Mix Cutter works in three steps:

### 1. Import
- Drag and drop a recording, or click to choose one. Most formats work: MP3, M4A / iPhone Voice Memos, WAV, AIFF, FLAC, even phone videos.
- Pick the **band** from your saved list, or type a new one and it is remembered for next time.
- Set the **date**. It defaults to today, with a date picker.
- Add optional **notes**: who was there, what you worked on, and so on.
- Choose what happens after the songs are found:
  - **Stop so I can review**: check and adjust the cuts before saving (recommended).
  - **Do everything automatically**: cut, save, and upload without stopping.

### 2. Cut up songs
- Mix Cutter listens to the recording and tells **songs** (loud, continuous playing) apart from **talk** (quieter, choppy).
- In review mode you get a waveform editor where you can:
  - drag the edges of a song to adjust where it starts or ends
  - play any song, or click anywhere to listen
  - rename songs, skip ones you don't want, split one in two, merge two together, or add a song by hand
  - re-run detection with a sensitivity slider if it found too many or too few songs
- **Save** writes high-quality (320 kbps) MP3s with artist, album, and track tags:
  ```
  ~/Music/Mix Cutter/<Band>/<YYYY-MM-DD> - <Band> Practice/
    01 - Song 1 (0m23s).mp3        ← number, name, and where it starts in the recording
    02 - Song 2 (12m40s).mp3
    Session Info.txt               ← band, date, notes, and a track list with timestamps
  ```

### 3. Publish to SoundCloud
- Uploads each song to your SoundCloud account as a **private** track.
- Groups them into a **private playlist** named like *"The Garage Kings - Practice 2026-11-01"*.
- Gives you a share link to copy into the band chat. Only people with the link can listen.

---

## How to run it

### Requirements
- A Mac (Windows and Linux should work but are untested)
- [Node.js](https://nodejs.org) 20.12 or newer
- [ffmpeg](https://ffmpeg.org) for audio processing. On a Mac with [Homebrew](https://brew.sh): `brew install ffmpeg`

### Install
```bash
git clone https://github.com/markrocks/mix-cutter.git
cd mix-cutter
npm install
cp .env.example .env
```

### Start
```bash
npm start
```
Then open **http://localhost:4317** in your browser.

Leave the Terminal window open while you use the app. Press `Ctrl + C` to stop it.

### Try it without a real recording
Build a short fake practice recording (spoken chatter plus three made-up "songs") and import it:
```bash
npm run fixture      # creates test/fixtures/practice.m4a (macOS only, uses the `say` command)
```

---

## Upload from your phone

1. Start the app on your computer.
2. Click **Phone upload** in the top bar. A QR code appears.
3. Scan it with your phone's camera. Your phone and computer must be on the **same Wi-Fi**.
4. Choose the recording on your phone and import it as usual. It is sent straight to your computer.

To turn phone access off, set `HOST=127.0.0.1` in `.env`.

---

## Connect SoundCloud

You only need this for step 3 (publishing). Everything else works without it.

1. **Create a SoundCloud app** at https://soundcloud.com/you/apps.
   - *App URL*: any website you own, such as your personal site or this GitHub repo. It's only shown on the app's info page.
   - *Redirect URI*: exactly `http://localhost:4317/auth/soundcloud/callback`
   - SoundCloud may review new apps before the credentials work.
2. **Add the credentials** to the `.env` file in the `mix-cutter` folder. It's a hidden file: in Finder press `Cmd + Shift + .` to see it, or run `nano .env` in Terminal.
   ```
   SOUNDCLOUD_CLIENT_ID=your-client-id
   SOUNDCLOUD_CLIENT_SECRET=your-client-secret
   SOUNDCLOUD_REDIRECT_URI=http://localhost:4317/auth/soundcloud/callback
   ```
3. **Restart** the app (`Ctrl + C`, then `npm start`).
4. In the app, go to **Settings → Connect SoundCloud** and sign in. Do this on the computer at `http://localhost:4317`, not from a phone.

Notes:
- `.env` is never committed to git, so your secret stays on your computer.
- Set `SOUNDCLOUD_DRY_RUN=1` to simulate uploads, so you can test the whole flow without touching your account.
- Free SoundCloud accounts have a limit on total upload time. Long practices may need SoundCloud Pro.

---

## Settings

Open **Settings** (gear icon) to change:
- where song folders are saved (default `~/Music/Mix Cutter`)
- the default mode for new imports (review or automatic)
- song-detection defaults: sensitivity, shortest song length, how long a quiet gap inside a song can be, and extra lead-in/tail
- your saved band names

All other options live in `.env` (see `.env.example`): port, phone access, output folder, and SoundCloud.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ffmpeg: command not found` | Install ffmpeg: `brew install ffmpeg` |
| Port 4317 already in use | Another copy is running. Stop it, or set `PORT=` to another number in `.env` (and update the SoundCloud redirect URI to match). |
| Phone can't open the page | Check both devices are on the same Wi-Fi, and that `HOST=0.0.0.0` in `.env`. Your Mac's firewall may ask to allow incoming connections for Node. Allow it. |
| Songs missed or merged together | On the review screen, open **Detection settings**, adjust the sensitivity or "join gaps under", and press **Re-detect**. |
| SoundCloud sign-in fails | The redirect URI in `.env` and on your SoundCloud app must match exactly. |

---

## For developers

```bash
npm run dev     # restart automatically when server files change
npm test        # song-detection unit tests
```

```
server/
  index.js       Express API + serves the web UI
  pipeline.js    background steps: analyze → cut → upload (chains automatically in automatic mode)
  analyze.js     one ffmpeg pass: audio features + waveform + browser preview
  segment.js     song detection (pure functions, unit-tested)
  cutter.js      ffmpeg cutting, MP3 tagging, folder naming
  soundcloud.js  OAuth 2.1 + PKCE sign-in, track upload, playlist creation
  store.js       JSON storage for bands, settings, sessions (in data/)
public/          browser UI (plain ES modules, no build step)
test/            unit tests and the fake-recording generator
```

**How song detection works:** for every second of audio, Mix Cutter measures loudness and how often the sound drops toward silence (speech does this constantly; a band playing doesn't). It smooths these, picks a talk-vs-music threshold automatically (Otsu's method), joins short quiet gaps inside songs, drops anything shorter than the minimum song length, and pads each song so count-ins and the last ringing chord are kept.

Working data (uploads, analysis, previews) is stored in `data/`. Deleting a session in the app removes only that working copy. Saved song folders and SoundCloud uploads are kept.
