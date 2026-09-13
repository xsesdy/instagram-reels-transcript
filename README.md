# Instagram Reels Transcript — open-source tool

A small, no-frills tool that turns an Instagram video or Reel into text: paste a link, get the spoken words as a transcript, copy it or download it as TXT or SRT subtitles.

**Live tool: [igscript.com](https://igscript.com)** — free, no signup.

## What's in this repo

| Path | What it is |
|---|---|
| `src/index.html` | Single-page frontend: link input + transcript output with Copy / TXT / SRT export |
| `src/tool.js` | The widget logic (fetch, segmented output, SRT assembly, downloads) |
| `src/site.css` | Shared styles for the tool pages |
| `src/transcript.pages-function.js` | The Cloudflare Pages Function behind `POST /api/transcript` |
| `examples/sample-transcript.json` | Raw API response from a real transcription run (public Reel, English) |
| `examples/sample-transcript.txt` | The same transcript as plain text |
| `examples/sample-transcript.srt` | The same transcript assembled as SRT subtitles |
| `examples/sample-transcript.csv` | The same segments as CSV (index, start, end, text) |

## How it works

1. The frontend posts the Instagram URL to a Cloudflare Pages Function.
2. The server-side function calls a third-party transcript API with the URL.
3. The API returns timed segments; the function normalizes them to `{ text, segments[] }` and the widget renders text + SRT.

**The upstream API key is never exposed** — it lives in server-side environment variables only (`SUPADATA_API_KEY`). Nothing is stored: links and transcripts exist only in the visitor's browser session.

## Run your own

1. Create a Cloudflare Pages project and deploy the `src/` files (Functions directory layout: `functions/api/transcript.js`).
2. Set the `SUPADATA_API_KEY` environment variable in the Pages project settings (get a key from your transcript API provider).
3. Bind your domain, done.

## License

MIT — use it, fork it, ship it.
