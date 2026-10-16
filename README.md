# FocusRead — lexim i fokusuar

An offline-first reading app (PWA): word-by-word speed reading, a guided page mode and a real book
mode with page turns. Imports PDF, EPUB, DOCX, TXT, Markdown and HTML, and syncs a library between
devices with end-to-end encryption.

**Live:** https://focusread.muamer-arifi.workers.dev

## Deploying

This repo **is** the live app. Every push to `main` is built and deployed automatically by Cloudflare
Workers Builds (`npx wrangler deploy`) to the address above. Same domain, same data, no manual step.

- Data is not in this repo. Books, positions, highlights and bookmarks sync through Neon Postgres,
  reached with the `DATABASE_URL` secret set on the Cloudflare worker. A deploy never touches it.
- Keep `"name": "focusread"` in `wrangler.jsonc` (that is what keeps the same address) and never
  delete the `DATABASE_URL` secret in Cloudflare.
- Manual deploy, if ever needed: `npm install` then `npx wrangler deploy`.

After changing any file in `public/`, run `node scripts/build-sw.mjs` so installed apps see an
"update available" message and pick up the change.

## Features (v6.5)

- **Reading modes:** words (RSVP with ORP highlight, smart pacing, blink pauses), guided page, and book
  mode with a paper page-turn. Two pages side by side on wide or landscape screens, and a rotate
  button for one or two pages.
- **Saving sentences:** the star button, then tap any sentence to save exactly that one (any mode), or
  press and hold a sentence to save it at once. Bookmarks per page or sentence.
- **Home page:** saved sentences and bookmarks in one folder per book, plus a Continue card.
- **Display:** 10 reading fonts, text colour and transparency, themes and paper textures, a 3-line
  drop cap in book mode, text size buttons in the bottom bar.
- **Import:** PDF (pdf.js), EPUB and DOCX (JSZip), TXT, MD, HTML, SRT. On phones the picker shows all
  files and the type is detected from the content. Files can also be shared to FocusRead from other
  apps (Share → FocusRead).
- **Sync:** a 16-character code; the server only stores a hash of it and AES-GCM ciphertext.
- Read aloud, chapters and contents, reading stats and a daily goal, Albanian and English.

## Layout

- `public/`: the app, served by Workers Static Assets (`index.html`, `css/`, `js/`, `fonts/`,
  `icons/`, `vendor/`, `sw.js`, `manifest.webmanifest`, `_headers`)
- `api/sync.js`: the sync API (Neon Postgres, tables `fr_items` and `fr_texts`)
- `worker.js`: routes `/api/*` to the API and serves everything else from `public/`
- `scripts/build-sw.mjs`: refreshes the service worker's file list and version
- `scripts/render-icons.py` + `scripts/maskable.svg`: render the PNG icons from `public/icons/icon.svg`

## Local testing

Put `DATABASE_URL=…` in a `.dev.vars` file (git-ignored), then `npm install` and `npm run dev`.
