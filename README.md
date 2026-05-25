# TraceShadow

TraceShadow is a web app built for BasisHacks 2026. A user enters a public website URL, and the app reveals the hidden third-party domains and network requests loading behind the visible page.

The central idea is simple. A website can look like one clean surface, but underneath that surface the browser is often reaching outward to many other systems. TraceShadow turns that hidden activity into something visible, structured, and explainable.

## Theme Connection

This project is built directly around **Beneath the Surface**.

On the surface, a website looks like a single page. Beneath the surface, it may be pulling in fonts, scripts, images, APIs, embeds, and other outside resources from many domains. TraceShadow makes that buried layer visible. It shows the network that normally stays hidden, which means the theme is not an extra decoration added afterward. The hidden layer is the project itself.

This fits the senior rubric especially well because the project focuses on **invisible networks powering modern life**, which is one of the clearest examples named in the theme explanation.

## What It Shows

TraceShadow is designed so a judge can understand it quickly. The app shows:

- a live scan panel that updates while the page is loading
- summary cards for requests, third-party activity, hidden domains, and scan time
- a network graph centered on the scanned website
- solid arrows for resources loaded directly by the page
- dashed arrows for resources loaded indirectly by another script, iframe, or redirect
- a domain table with request counts, resource types, and sample URLs
- a details panel for the selected domain
- a simple exposure score based on hidden-domain count and request volume

## How To Use It

1. Open the app.
2. Enter a public website URL.
3. Start the scan.
4. Watch the live evidence update as hidden domains appear.
5. Review the final cards, graph, and domain details.
6. Click domains in the table or graph to inspect them more closely.

This flow works well in a short demo because it starts with a familiar page and then reveals the hidden structure underneath it in real time.

## Tech Stack

- Frontend: React, JavaScript, Vite, Tailwind CSS
- Graph: Cytoscape.js
- Backend: Python, FastAPI, Uvicorn
- Browser analysis: Playwright
- Frontend hosting: Vercel
- Backend hosting: Render

## Public Links

Frontend:

```text
https://traceshadow-lime.vercel.app
```

Backend health check:

```text
https://traceshadow-api.onrender.com/api/health
```

## Run Locally

Install everything:

```bash
npm install
npm run install:backend
npm run install:browsers
```

Start both frontend and backend:

```bash
npm run dev
```

Then open:

```text
http://localhost:5173
```

If you want to run them separately:

```bash
npm run dev:frontend
npm run dev:backend
```

## Environment Variables

Backend:

```text
CORS_ORIGIN=http://localhost:5173
SCAN_TIMEOUT_MS=15000
```

Frontend:

```text
VITE_API_BASE=http://localhost:4000
```

In production, `VITE_API_BASE` should point to the public backend URL.

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

Stream live scan updates:

```bash
curl -N -X POST http://localhost:4000/api/analyze-stream \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

## Deployment

The frontend is deployed on Vercel, and the Playwright scanner runs on Render.

Render uses:

- the root `render.yaml`
- the backend Dockerfile at `apps/backend/Dockerfile`

The main production variables are:

```text
VITE_API_BASE=https://traceshadow-api.onrender.com
CORS_ORIGIN=https://traceshadow-lime.vercel.app
```

This split deployment matters for a practical reason. The frontend is light and fits Vercel well, while the scanner needs a browser runtime that works better on Render.

## Demo Flow

This is the cleanest 1 to 3 minute demo plan:

1. Open TraceShadow.
2. Enter a public website URL.
3. Show the live evidence appearing before the scan finishes.
4. Explain the summary cards.
5. Use the graph to point out direct and indirect links.
6. Click a domain and show the sample URLs and request types.
7. End by reconnecting the result to the theme: what looked like one page was actually a hidden network.

Demo video:

```text
Add your final 1-3 minute video link here before submission.
```

## Submission Checklist

This repo already supports these rubric requirements:

- public GitHub repository
- open-source code
- README with project explanation and setup steps
- public working demo URL
- meaningful theme connection
- original technical concept appropriate for the senior division

These items still depend on your team, not just the repo:

- make sure the final build you submit was created during the hackathon
- record and add the 1 to 3 minute demo video link
- keep AI assistance under 30% of the total work

That distinction matters. A good submission is not only about code existing; it is about the evidence around the code matching the story you want judges to believe.

## Limitations

- some sites block headless browsers
- the app does not try to bypass anti-bot protections
- the free Render instance may be slow on the first request after inactivity
- results depend on what loads during the scan window

## Project Layout

```text
traceshadow/
  README.md
  package.json
  render.yaml
  vercel.json
  apps/
    backend/
      requirements.txt
      Dockerfile
      app/
        main.py
    frontend/
      index.html
      vite.config.js
      tailwind.config.js
      src/
        main.jsx
        TraceShadowApp.jsx
        index.css
```

The source is intentionally compressed so the main logic is easy to review. Most of the backend lives in `main.py`, and most of the frontend lives in `TraceShadowApp.jsx`.

## License

MIT

TraceShadow is really a project about attention. When something looks simple on the surface, there is often a deeper structure beneath it, and understanding begins when we decide to look closely enough to see it.
