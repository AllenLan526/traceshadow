# TraceShadow

I made TraceShadow for the BasisHacks 2026 theme, "Beneath the Surface." The basic idea is that a website can look simple from the outside, but while it loads, the browser is often reaching out to a lot of other domains in the background. I wanted a way to make that hidden activity visible in a form that is easy to scan and explain.

## What it does

TraceShadow lets a user enter a public website URL and scan it in the browser.

It shows:

- live updates while the scan is running
- total requests, third-party requests, hidden domains, and scan time
- a graph with the main site in the center and outside domains around it
- a table of detected domains, request counts, and resource types
- sample request URLs for each domain
- a simple exposure score based on how many third-party domains and requests were found

The score is only a simple estimate. It is not meant for professional use.

## How it works

The app has a React frontend and a Python backend.

The user enters a URL in the frontend. The frontend sends that URL to the backend and listens to a streaming endpoint, so results can appear while the page is still loading instead of waiting for the whole scan to finish.

The backend uses Playwright to open the page in a headless Chromium browser and listen to network requests. It groups requests by third-party domain, keeps a few sample URLs for each one, builds the graph data, and calculates the score.

There are two API routes:

- `POST /api/analyze` for a normal full result
- `POST /api/analyze-stream` for live updates during the scan

The backend also blocks unsafe targets like `localhost`, private IP ranges, and `file://` URLs.

If you need to edit the project, these are the main files:

- `apps/backend/app/main.py` has the scan logic, request parsing, graph building, scoring, and URL safety checks
- `apps/frontend/src/TraceShadowApp.jsx` is the main frontend flow and state
- `apps/frontend/src/components/Panels.jsx` has most of the UI sections
- `apps/frontend/src/components/GraphBox.jsx` renders the graph
- `apps/frontend/src/lib/scan.js` handles the streaming scan response

## Technologies used

- React: frontend UI
- Vite: frontend dev server and build tool
- Tailwind CSS: styling
- Cytoscape.js: network graph
- Python: backend language
- FastAPI: API server
- Uvicorn: local backend server
- Playwright: headless browser scanning

## How to run it

Install everything:

```bash
npm install
npm run install:backend
npm run install:browsers
```

Start the frontend and backend together:

```bash
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:4000
```

You can also run them separately:

```bash
npm run dev:frontend
npm run dev:backend
```

To check that the repo still builds:

```bash
npm run check
```

## Demo video

https://www.youtube.com/watch?v=kSNfSz7ElwI

## Project structure

The repo is small on purpose. I kept most of the important logic in a few files so it is easier to review and explain.

```text
traceshadow/
  apps/
    backend/
      app/
        main.py
    frontend/
      src/
        TraceShadowApp.jsx
        components/
          GraphBox.jsx
          Panels.jsx
        lib/
          scan.js
          view.js
  package.json
  render.yaml
  vercel.json
```

## Current limitations

- some sites block headless browsers, so scans can fail or come back partial
- the score is a rough estimate, not a real privacy audit
- the app only looks at what loads during the scan window
- there is no saved history or comparison between scans

## Possible improvements

- save past scans and compare them over time
- export results in a cleaner report format
- make the graph easier to read on large scans
- show more detail about which requests came from scripts, frames, or redirects
