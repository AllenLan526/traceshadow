# TraceShadow

TraceShadow is a browser-based privacy visibility tool for BasisHacks 2026. A user enters a website URL, and the app reveals the third-party domains, scripts, trackers, analytics tools, CDNs, ad networks, and social widgets that load beneath the surface of the page.

## Theme Connection

Most websites look simple on the surface, but underneath they load scripts, trackers, analytics tools, ad networks, CDNs, and social widgets. TraceShadow makes these invisible systems visible, turning hidden network activity into an understandable map.

## Features

- URL analyzer backed by Playwright network request collection
- Live scan updates that show hidden domains as soon as they are found
- Local rule-based classifier for analytics, ads, CDN, social, tag manager, and unknown domains
- Privacy exposure score from 0 to 100 with a transparent formula
- Interactive network graph powered by Cytoscape.js
- Summary cards, domain table, and click-to-inspect domain details
- Honest error handling for blocked pages
- Built-in demo scan for reliable hackathon demos

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Graph: Cytoscape.js
- Backend: Node.js, Express, TypeScript
- Browser analysis: Playwright

## Project Structure

```text
traceshadow/
  README.md
  package.json
  apps/
    backend/
      src/
        server.ts       API routes
        analyze.ts      URL validation, Playwright scan, classification, score, demo data
    frontend/
      src/
        main.tsx
        TraceShadowApp.tsx   full frontend app, API client, live scan UI, graph, demo data
        index.css
```

The source is intentionally compressed so the main hackathon logic is easy to review quickly. `server.ts` shows the API surface, `analyze.ts` shows the backend scan pipeline, and `TraceShadowApp.tsx` shows the full user experience.

## Local Setup

Install dependencies from the project root:

```bash
npm install
npm run install:browsers
```

Run both apps:

```bash
npm run dev
```

Open the frontend at:

```text
http://localhost:5173
```

The backend runs at:

```text
http://localhost:4000
```

## Running Apps Separately

Backend:

```bash
npm run dev:backend
```

Frontend:

```bash
npm run dev:frontend
```

## Troubleshooting Local Ports

If `npm run dev` says port `4000` or `5173` is already in use, an older dev server is still running. Stop it with `Ctrl+C` in the old terminal, or find the process:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Then stop the listed PID:

```bash
kill <PID>
```

## Environment Variables

Backend optional variables:

```text
PORT=4000
CORS_ORIGIN=http://localhost:5173
SCAN_TIMEOUT_MS=15000
```

Frontend optional variables:

```text
VITE_API_BASE=http://localhost:4000
```

## API

Health check:

```bash
curl http://localhost:4000/api/health
```

Analyze a URL:

```bash
curl -X POST http://localhost:4000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Stream a URL scan as newline-delimited JSON:

```bash
curl -N -X POST http://localhost:4000/api/analyze-stream \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com"}'
```

Demo data:

```bash
curl http://localhost:4000/api/demo
```

## Deployment

Current public deployment:

```text
https://traceshadow-lime.vercel.app
```

TraceShadow is configured as a single Vercel deployment. The Vite frontend is served from `apps/frontend/dist`, and the public `/api/*` routes are Vercel Functions that reuse the backend scan logic.

Vercel settings are stored in `vercel.json`:

```text
Install command: npm install
Build command: npm run build
Output directory: apps/frontend/dist
```

## Demo Video Workflow

Use this for a 1 to 3 minute demo:

1. Open TraceShadow and enter a public website URL.
2. Point out the live scan panel as domains appear while the page is still loading.
3. Show the loading steps: opening the page, collecting requests, classifying domains, building the graph.
4. Explain the summary cards and privacy exposure score after the final dashboard appears.
5. Click graph nodes to show hidden third-party domains and sample requests.
6. Open the tracker table and point out analytics, ads, CDN, social, and tag manager categories.
7. Click `Load Demo Scan` to show the fallback path for sites that block scanning.
8. Close by connecting the project to "Beneath the Surface."

Demo video link: `TODO add final 1-3 minute video link`

Public demo URL: `https://traceshadow-lime.vercel.app`

## Known Limitations

- The privacy exposure score is an educational approximation, not a professional privacy audit.
- Some websites block headless browsers or delay requests until user interaction.
- The classifier is rule-based and intentionally simple.
- The app does not bypass anti-bot protections.
- User-submitted URLs are scanned in memory and are not stored permanently.

## Future Improvements

- Add exportable reports
- Add side-by-side website comparison
- Improve classifier rules
- Detect cookie banners and consent tools
- Add historical scan comparison if storage is added later

## License

MIT
