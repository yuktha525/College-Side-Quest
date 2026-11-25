# ⚔️ CampusSideQuest

A lightweight, RPG-themed campus micro-favors and skill-barter quest board built with **zero external dependencies** (Python 3 + SQLite + Vanilla JS/CSS).

## Features
- **Uncluttered RPG Quest Board:** Filter by **Quick Rescue**, **Skill Swap**, **Campus Errand**, and **Squad Up**, or search by location/reward.
- **4-Digit Handshake PIN:** Posters get a 4-digit PIN to share in person; helpers enter it to complete the quest, trigger confetti + victory chimes, and claim XP.
- **XP, Levels, Badges & Reliability:** Level up from *Campus Rookie* to *Campus Legend*, unlock achievement badges, and compete on **Department & Hostel Leaderboards**.
- **Real-Time Live Feed & Party Chat:** Instant updates across tabs/devices via Server-Sent Events (SSE).
- **1-Click Demo Heroes + Custom Sign Up:** Pre-seeded demo accounts for effortless presentations, plus full registration/login.

## Modes
1. **GitHub Pages / Static Mode:** Works out of the box from the repository root (`index.html`, `styles.css`, `app.js`) using browser `localStorage` for demo heroes, quest posting, 4-digit PIN handshakes, XP/badges, and leaderboards.
2. **Full-Stack Server Mode (`python3 app.py`):** Uses the built-in Python 3 + SQLite backend with real-time Server-Sent Events (`/api/events`) across devices.

## Run Locally

```bash
python3 app.py
```

Open **http://localhost:8000** in your browser.

## Run Tests

```bash
python3 -m unittest discover -s tests -v
```

## Optional Environment Variables
- `PORT` (default: `8000`)
- `HOST` (default: `0.0.0.0`)
- `CSQ_DB_PATH` (default: `./data/campus_side_quest.db`)
- `CSQ_SECRET` (optional custom HMAC signing secret)
- `CSQ_ALLOWED_DOMAINS` (optional comma-separated domain restriction for signup, e.g. `campus.edu,college.ac.in`)

## Deploy Anywhere
Because there are no external pip/npm dependencies, you can deploy directly with Python 3 (`Procfile` and `Dockerfile` included) on Render, Railway, Fly.io, or any VPS:

```bash
docker build -t campus-side-quest .
docker run -p 8000:8000 campus-side-quest
```
