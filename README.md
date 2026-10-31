# HRV Reader

Resting heart-rate variability from a Garmin HRM 600 chest strap, in the browser. The page talks to the strap with Web Bluetooth, times a short seated session, and keeps every session on the device. A demo mode generates synthetic beats so the whole flow works without hardware.

Nothing is uploaded. Sessions live in `localStorage`.

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

The history view charts HRV score and resting HR, plus a **7-day rolling average** of each (a session exactly seven days earlier still counts). Export JSON or CSV, including raw and filtered RR. Import merges by id and skips duplicates. Tags can be edited later. Delete removes a session from this browser only.

## Develop

```bash
npm install
npm test
npm run dev
npm run build
```

`npm run build` typechecks and writes a static site to `dist/`. Vitest covers the Heart Rate Measurement parser (flags, 8- and 16-bit HR, energy expended, multiple RR intervals in 1/1024 s units) and the HRV math (filter, time domain, Poincaré, 4 Hz interpolation, Welch LF/HF).

## Deploy

Vercel detects Vite and publishes `dist` with no extra configuration. Navigation uses the URL hash (`#history`), so the site does not need a rewrite rule and does not ship a `vercel.json`. Import the repository, leave the framework preset on Vite, and deploy.
