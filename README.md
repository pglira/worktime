# Worktime

A Progressive Web App that tracks working time.

- Tap Start when work starts and Stop when it ends.
- After Stop, the notes of the time block open: a list of items, for example the tasks done.
- Attach labels to a time block, for example projects. A new block gets the labels of the last block.
- The start page shows the timer, the totals of today, this week and this month, and the blocks of the last 7 days.
- The overview shows one week or one month: totals, a bar per day, the time per label and the blocks of each day with their notes. "Copy as text" copies a report of the period.
- Tap + to add a time block that you did not track live. Swipe a block to the left to show Edit and Delete.
- Back up all data to a file and import it on a new phone: tap the backup button in the header of the overview. The import replaces all data after a second tap.

## Tech

- React, TypeScript and Vite
- `vite-plugin-pwa` for the manifest, the service worker and the offline cache
- `localStorage` for the data

## Development

```bash
npm install
npm run dev
```

## Deployment

The GitHub Actions workflow `.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages on each push to `main`. The app is served at `https://pglira.github.io/worktime/`.

## Install on iOS

Open the URL in Safari, tap Share and select "Add to Home Screen".
