# HRV Reader

Resting heart-rate variability from a Garmin HRM 600 chest strap, in the browser. The page talks to the strap with Web Bluetooth, times a short seated session, and keeps every session on the device. A demo mode generates synthetic beats so the whole flow works without hardware.

Nothing is uploaded to a server. Sessions are cached in `localStorage`. Chrome and Edge can also keep `hrv-data.json` in a folder you choose, such as Dropbox, OneDrive, or iCloud.

## Use it

1. Open the site in **Chrome or Edge on a computer**. Safari and Firefox do not implement Web Bluetooth; the page says so, and demo mode still works.
2. Unsnap the strap from your watch and disconnect it in Garmin Connect. The HRM 600 holds one Bluetooth link, and the watch will keep it.
3. Wet the electrodes, wear the strap snug, and tap the module if it is asleep.
4. Choose **Connect strap** and pick the HRM 600. Battery level is read when the strap exposes the standard Battery Service.
5. Pick a length (1, 2, 3, or 5 minutes; 2 is the default) and start. Sit still and breathe normally.
6. Save the result, with optional sleep, soreness, stress (each 1–5), and a note.

**Simulate strap** runs the same session on a synthetic RR series: a resting rhythm, respiratory sinus arrhythmia, a slower wave, and a few ectopic beats for the artifact filter.

The tab has to stay open. Web Bluetooth needs a secure context (HTTPS, or `localhost` during development).

## What the numbers mean

Intervals outside **300–2000 ms** are dropped. A remaining beat is dropped when it differs by **more than 20%** from the median of the in-range beats up to two places on either side (the beat itself is excluded; an exact 20% difference is kept). **Beats removed** is that count as a percentage of every RR interval in the session.

Time-domain results use the cleaned intervals, in order:

| Result | Definition |
| --- | --- |
| Mean HR | 60 000 / mean NN interval. This is the resting HR on the history chart. |
| RMSSD | Root mean square of successive differences (ms). |
| ln(RMSSD) | Natural log of RMSSD. |
| HRV score (Elite-style approximation) | `ln(RMSSD) × 20`. This is not the official Elite HRV score. |
| SDNN | Sample standard deviation of NN intervals (n − 1). |
| pNN50 | Percent of successive absolute differences greater than 50 ms. |
| SD1, SD2 | Sample standard deviations of the Poincaré pairs, perpendicular to and along the line of identity. |
| LF/HF | Welch PSD of the NN tachogram after linear interpolation to 4 Hz. LF is 0.04–0.15 Hz, HF is 0.15–0.40 Hz. Hann window, 50% overlap, segments of 256 samples (64 s) or the longest shorter power of two that fits. |

LF/HF is marked **unreliable under 2 minutes**. A completed 2, 3, or 5 minute session is treated as long enough; a 1 minute session is not.

Live RMSSD and the tachogram update from the cleaned beats while the clock runs. The strap’s heart-rate field is the live bpm; mean HR in the results comes from the RR intervals.

## History

The history view charts HRV score and resting HR, plus a **7-day rolling average** of each (a session exactly seven days earlier still counts). Export JSON or CSV, including raw and filtered RR. Import merges by id and skips duplicates. Tags can be edited later. Delete removes a session here and records a tombstone, so cloud sync and a connected folder drop that session on the other device too.

## Cloud sync

Phone and desktop share one history through `api/sessions`, a Vercel Function that stores a single JSON document in Vercel Blob. The object pathname is fixed and not a public filename (`addRandomSuffix: false`, overwrite allowed, private access). The client never talks to Blob directly.

Set these environment variables on the Vercel project. Names are exact:

| Name | Where | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Server only | Read-write token for the Blob store. `@vercel/blob` uses it for `get` and `put`. |
| `HRV_PASSPHRASE` | Server only | Shared secret. The function rejects any request whose `x-hrv-passphrase` header does not match, compared with a SHA-256 digest and `timingSafeEqual`. |

Create a **private** Blob store and connect it so the token is available. Do not prefix either name with `VITE_` — that would expose them in the browser bundle. Each device types the same passphrase into **Cloud sync** (saved in `localStorage` on that device) and turns the toggle on.

On load, and after every save, edit, delete, or import, the app GETs the document, merges it with the local cache, and PUTs the result. The merge is the folder-sync union by session id (this browser’s copy wins when both still have the session). Deletes are tombstones: if either side has deleted an id, that session is removed and the tombstone is kept, so the delete propagates. `localStorage` remains the cache. The card shows syncing, the last synced time, and errors.

`npm run dev` does not serve `/api/sessions`. `npm run build` bundles the function to `api/sessions.mjs` (one ESM file, `@vercel/blob` left external) so Node can load it when `package.json` has `"type": "module"`. The route is deployed with the site on Vercel. Locally, `vercel dev` serves it when the env vars are present.

## Sync folder

**Sync folder** uses the File System Access API (`showDirectoryPicker`) in Chrome or Edge. Pick a directory that your cloud drive already syncs. The app reads and writes `hrv-data.json` in that directory. The file is the same JSON export: every session, including raw RR.

The directory handle is stored in IndexedDB. After a restart the browser usually forgets write permission until you click **Reconnect folder**. Permission is requested only from that click. If the API is missing, the control explains that and the app keeps using `localStorage`.

On connect and on load (once permission is already granted), the file and the `localStorage` cache are merged by session id:

- Every id from either side is kept once.
- When both sides have the same id, this browser’s copy wins, so an edit that has not been written yet is not replaced by an older file.
- Sessions that exist only in the file are added, which is how a cleared browser gets its history back.
- The combined list is written back to the folder and saved to `localStorage`.

Saving a session, editing tags or notes, deleting, and importing all write the file again. The card shows the folder name, the last synced time, and the error if a read or write fails.

## Develop

```bash
npm install
npm test
npm run dev
npm run build
```

`npm run build` typechecks and writes a static site to `dist/`. Vitest covers the Heart Rate Measurement parser (flags, 8- and 16-bit HR, energy expended, multiple RR intervals in 1/1024 s units), the HRV math (filter, time domain, Poincaré, 4 Hz interpolation, Welch LF/HF), the folder and cloud merge (union by session id, local copy wins, tombstones propagate deletes, raw RR kept), and API auth (missing token, missing passphrase, wrong passphrase, PUT then GET).

## Deploy

Vercel detects Vite and publishes `dist` with no extra configuration. Navigation uses the URL hash (`#history`), so the site does not need a rewrite rule and does not ship a `vercel.json`. Import the repository, leave the framework preset on Vite, and deploy.
