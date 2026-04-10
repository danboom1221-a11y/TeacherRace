# Teacher Race System

Single-user local web app for running a live teacher competition dashboard with smooth race-style animations.

## Run locally

No build tools are required.

1. Open Terminal in this folder:
   - `/Users/daniyal/Desktop/Superviser/teacher-race-system`
2. Start a local server:
   - `python3 -m http.server 5500`
3. Open:
   - `http://localhost:5500`

## Features

- Add/remove participants with duplicate-name protection
- Score controls (`+5`, `+10`, `-5`) with live animated reordering
- Race-style horizontal bars sorted by score
- Top-3 medals with distinct visual treatment
- Rank change indicators (`▲`/`▼`)
- Biggest mover badge
- Cinematic finish mode with dramatic pause, top-3 reveal, and confetti
- Local persistence via `localStorage`
