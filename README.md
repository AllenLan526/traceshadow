# TraceShadowww

TraceShadow is a web app for BasisHacks 2026. A user enters a website URL, and the app reveals the hidden third-party domains, scripts, trackers, analytics tools, CDNs, ad systems, and social widgets that load behind the visible page.

The central idea of this project is simple. Most websites look calm and self-contained when you first open them, but that surface is misleading. Underneath, the browser is often reaching outward again and again to outside systems. TraceShadow turns that hidden traffic into something a person can actually see, follow, and explain.

## Theme Connection

This project is built around the theme **"Beneath the Surface."**

On the surface, a website can feel like one clean page. Underneath that surface, it may be pulling in analytics, ads, fonts, CDNs, social widgets, and tracking tools from many different domains. TraceShadow makes that hidden layer visible. It takes something quiet and buried inside the browser and turns it into evidence: domains, categories, request counts, a graph, and a plain-language explanation.

That is why the theme connection is not just decorative. The project works because the hidden layer is the project.

## What the App Shows

TraceShadow is meant to be understandable quickly, especially in a hackathon demo. The app shows:

- a live scan panel that updates as hidden domains are found
- summary cards for request counts and scan time
- a privacy exposure score from 0 to 100
- a graph that places the scanned website in the center and third-party domains around it
- a table of detected domains and categories
- a details panel with sample URLs and plain-English explanations

The score is intentionally simple and transparent. It is an educational estimate, not a professional privacy audit.

## How It Works

The app follows one clear path from input to explanation.

1. The user enters a website URL.
2. The frontend sends that URL to the backend.
3. The backend validates the URL and blocks unsafe targets like localhost or private IPs.
4. Playwright opens the page in a headless browser and listens to network requests.
5. TraceShadow groups requests by domain and classifies them with local rules.
6. The backend returns structured results.
7. The frontend turns those results into cards, a graph, a table, and short explanations.

This structure matters because it keeps the project explainable. Every part of the interface comes from the same evidence trail.

## Tech Stack

- Frontend: React, JavaScript, Vite, Tailwind CSS
- Graph: Cytoscape.js
- Backend: Python, FastAPI, Uvicorn
- Browser analysis: Playwright
- Frontend hosting: Vercel
- Backend hosting: Render

## Project Layout

The source is intentionally compressed so the main logic is easy to review.

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

The backend logic mainly lives in `main.py`, and the frontend experience mainly lives in `TraceShadowApp.jsx`. That decision was intentional. In a hackathon project, clarity is often more valuable than elegance, because a clean explanation is part of what makes the work convincing.

## Run Locally

Install the project:

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

The backend runs at:

```text
http://localhost:4000
```

If you want to run them separately:

```bash
npm run dev:frontend
npm run dev:backend
```

## Environment Variables

Most local development works without much setup, but these variables are available when needed.

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

## API Endpoints

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

The frontend is deployed on Vercel, and the live scanner runs on Render.

Frontend:

```text
https://traceshadow-lime.vercel.app
```

Backend health check:

```text
https://traceshadow-api.onrender.com/api/health
```

Render uses the root `render.yaml` blueprint and the backend Dockerfile at `apps/backend/Dockerfile`.

The main production variables are:

```text
VITE_API_BASE=https://traceshadow-api.onrender.com
CORS_ORIGIN=https://traceshadow-lime.vercel.app
```

This split deployment is practical for a reason. Vercel is a good fit for the frontend, but the Playwright-based backend needs a host that can support a heavier browser runtime. The architecture looks slightly more complex from the outside, but it is actually the simplest version that reliably works.

## Demo Plan

This is the clearest 1 to 3 minute demo flow:

1. Open TraceShadow.
2. Enter a public website URL and start a scan.
3. Show the live findings panel as domains appear before the scan finishes.
4. Explain the final cards, graph, and exposure score.
5. Click a few detected domains and show the explanations.
6. End by reconnecting everything to the theme: what looked like one page was actually a hidden network.

Demo video link:

```text
TODO add final video link
```

## Limitations

- The exposure score is an educational approximation.
- Some sites block headless browsers.
- The classifier is rule-based and intentionally simple.
- The app does not try to bypass anti-bot protections.
- The free Render instance may take longer on the first request after inactivity.

These limits are important to say out loud because honesty is part of the project’s credibility. The app is strongest when it presents hidden systems clearly without pretending to be more than it is.

## Future Improvements

- add exportable reports
- improve classifier coverage
- compare two websites side by side
- detect more consent and privacy tools
- store historical scans for comparison

## License

MIT

In the end, TraceShadow is about more than scanning requests. It is about the habit of looking past the first surface of things, because understanding often begins when we notice what was quietly there all along.
