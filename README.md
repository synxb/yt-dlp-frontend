# YT-DLP Frontend

A React + Python full-stack app for downloading YouTube playlists as MP3.

## Tech Stack
- **Frontend**: React + TypeScript + Vite
- **Backend**: Python (FastAPI) + yt-dlp
- **Communication**: REST API + Server-Sent Events (SSE) for real-time progress

## Flow
1. Paste a YouTube playlist URL
2. Preview playlist metadata and track listing
3. Click "Download Playlist" — backend creates the folder and starts yt-dlp
4. Watch real-time per-track download progress

## Setup

### Backend

1. Create and activate a Python virtual environment:
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Make sure `yt-dlp` and `ffmpeg` are on your PATH.  
   FFmpeg is required for MP3 conversion and thumbnail embedding.

4. Install the **Deno** JavaScript runtime (required by yt-dlp to solve
   YouTube's JS challenges — see the [yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)).
   The EJS solver scripts themselves are bundled via the `yt-dlp[default]`
   dependency, so no extra Python package is needed.

   ```bash
   # Windows
   winget install denoland.deno

   # Linux / macOS
   curl -fsSL https://deno.land/install.sh | sh
   ```

   Verify it is available:
   ```bash
   deno --version
   pip show yt-dlp-ejs   # should report an installed version
   ```

   > On Linux, Deno installs to `~/.deno/bin`. `start-backend.sh` adds this to
   > PATH automatically. If you run uvicorn another way, make sure `deno` is on
   > the PATH of that process (or install it to `/usr/local/bin`).

### Frontend

```bash
cd frontend
npm install
```

## Running (Development)

Open **two terminals**:

**Terminal 1 — Backend:**
```bash
# Windows
start-backend.bat

# Linux / macOS
./start-backend.sh

# or manually:
cd backend && uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
# Windows
start-frontend.bat

# Linux / macOS
./start-frontend.sh

# or manually:
cd frontend && npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

---

## Production Deployment

### 1. Build the frontend

```bash
cd frontend
npm run build
```

This outputs a static site to `frontend/dist/`.

### 2. Serve the frontend

Pick one of the following options:

**Option A — Serve via Python (quick, no extra deps)**
```bash
cd frontend/dist
python -m http.server 8080
# Visit http://localhost:8080
```

**Option B — Serve via `serve` (Node.js, recommended)**
```bash
npm install -g serve
serve -s frontend/dist -l 3000
# Visit http://localhost:3000
```

**Option C — Serve via nginx**

Copy `frontend/dist/` to your nginx web root, and add a location block to handle SPA routing:

```nginx
server {
    listen 80;
    root /var/www/yt-dlp-frontend;
    index index.html;

    # Proxy API requests to the FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Required for Server-Sent Events
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    # SPA fallback — serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 3. Run the backend (production)

For production, run uvicorn **without** `--reload` and optionally behind a process manager:

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

> Use `--workers 1` — the app holds download sessions in memory, so multiple workers would cause sessions to be invisible across processes.

**With systemd (Linux):**

```ini
[Unit]
Description=YT-DLP Backend
After=network.target

[Service]
WorkingDirectory=/path/to/yt-dlp-frontend/backend
Environment=PUBLIC_BASE_URL=https://ytdlp.lan.hackinginstyle.com
Environment=PATH=/home/youruser/.deno/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/path/to/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### 4. Configure the frontend API base URL

By default the frontend calls `http://localhost:8000`. If your backend runs on a different host or port, update the `BASE` constant in `frontend/src/api.ts` before building:

```ts
const BASE = 'http://your-server:8000';
```

Or, if using nginx with the proxy config above, set it to an empty string so all `/api/` calls are relative:

```ts
const BASE = '';
```

Then rebuild: `npm run build`.

### 5. Configure the Google OAuth redirect (DLoad feature)

The "DLoad" feature authorizes against Google/YouTube via OAuth. The redirect
URL must match the host the app is served from.

1. **Set the public base URL** so the backend builds the correct redirect.
   `start-backend.sh` already exports it for the deployed host:

   ```bash
   export PUBLIC_BASE_URL="https://ytdlp.lan.hackinginstyle.com"
   ```

   When `PUBLIC_BASE_URL` is unset (e.g. local Windows dev via
   `start-backend.bat`), the app falls back to
   `http://localhost:8000` / `http://localhost:5173` automatically.

2. **Register the redirect URI in Google Cloud Console.**
   Open your OAuth 2.0 Client → *Authorized redirect URIs* and add both:

   ```text
   http://localhost:8000/api/dload/oauth-callback
   https://ytdlp.lan.hackinginstyle.com/api/dload/oauth-callback
   ```

   The first is for local development; the second for the deployed service.



The download arguments are defined in `yt-dlp-arguments.txt` at the project root.  
The backend's `config.py` mirrors these settings as Python options passed directly to yt-dlp.

Key settings:
- Parallel downloads: 4 (`-N 4`)
- Format: MP3 at 320kbps
- Metadata + thumbnail embedding
- Windows-safe filenames (`--restrict-filenames`)

## Download location

By default, playlists are saved to `~/Music/YT-Downloads/<playlist-title>/`.  
You can change this on the Playlist Preview screen before downloading.
