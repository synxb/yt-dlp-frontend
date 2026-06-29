"""
FastAPI backend for yt-dlp-frontend.

Endpoints:
  GET  /api/playlist?url=<url>           — fetch playlist metadata
  POST /api/download                     — start a download session
  GET  /api/download/{id}/stream         — SSE progress stream
  DELETE /api/download/{id}              — cancel a download
  GET  /api/config                       — get current config (download dir)
  PUT  /api/config                       — update config
"""

from __future__ import annotations

import asyncio
import json
import os
import ssl
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

import downloader as dl
from config import DEFAULT_DOWNLOAD_DIR, PUBLIC_BASE_URL
import database as db
import dload as dl_dload

app = FastAPI(title="YT-DLP Frontend API", version="1.0.0")

_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if PUBLIC_BASE_URL:
    _cors_origins.append(PUBLIC_BASE_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    db.init_db()


# ─── Helpers ─────────────────────────────────────────────────────────────

def _track_to_dict(t: dl.TrackInfo) -> dict:
    return {
        "index": t.index,
        "id": t.id,
        "title": t.title,
        "url": t.url,
        "thumbnail": t.thumbnail,
        "duration": t.duration,
        "status": t.status,
        "progress": t.progress,
        "error": t.error,
    }


def _playlist_to_dict(p: dl.PlaylistInfo) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "url": p.url,
        "channel": p.channel,
        "thumbnail": p.thumbnail,
        "tracks": [_track_to_dict(t) for t in p.tracks],
    }


# ─── Routes ──────────────────────────────────────────────────────────────


@app.get("/api/playlist")
async def get_playlist(url: str = Query(..., description="YouTube playlist URL")):
    """Fetch playlist metadata without downloading."""
    if not url or not url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    loop = asyncio.get_running_loop()
    try:
        playlist = await loop.run_in_executor(None, dl.fetch_playlist_info, url.strip())
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return _playlist_to_dict(playlist)


def _persist_session(session: dl.DownloadSession) -> None:
    """Write the current session state to the DB (called after each track)."""
    db.upsert_session(
        session_id=session.id,
        playlist_id=session.playlist.id,
        title=session.playlist.title,
        url=session.playlist.url,
        channel=session.playlist.channel,
        thumbnail=session.playlist.thumbnail,
        download_dir=session.download_dir,
        status=session.status.value,
        completed=session.completed,
        total=session.total,
        tracks=[_track_to_dict(t) for t in session.playlist.tracks],
    )


class StartDownloadRequest(BaseModel):
    playlistUrl: str
    downloadDir: str | None = None
    trackIds: list[str] | None = None


@app.post("/api/download")
async def start_download(body: StartDownloadRequest, background_tasks: BackgroundTasks):
    """Start a download session and return the session ID."""
    if not body.playlistUrl:
        raise HTTPException(status_code=400, detail="playlistUrl is required")

    loop = asyncio.get_running_loop()
    try:
        playlist = await loop.run_in_executor(
            None, dl.fetch_playlist_info, body.playlistUrl.strip()
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    download_dir = (
        (body.downloadDir or db.get_setting("download_dir") or DEFAULT_DOWNLOAD_DIR).strip()
        or DEFAULT_DOWNLOAD_DIR
    )

    # Filter to only the selected tracks if the caller specified a subset
    if body.trackIds is not None:
        id_set = set(body.trackIds)
        playlist.tracks = [t for t in playlist.tracks if t.id in id_set]
        # Re-index so track indices are contiguous starting at 0
        for i, t in enumerate(playlist.tracks):
            t.index = i

    session = dl.create_download_session(playlist, download_dir)
    session._persist = _persist_session
    # Write initial DB row immediately so a refresh can see it right away
    _persist_session(session)

    async def _run_and_record() -> None:
        await dl.run_download(session)
        if session.status == dl.DownloadStatus.DONE:
            db.add_history_entry(
                playlist_id=playlist.id,
                title=playlist.title,
                url=playlist.url,
                track_count=len(playlist.tracks),
                channel=playlist.channel,
                thumbnail=playlist.thumbnail,
                download_dir=session.download_dir,
            )

    background_tasks.add_task(_run_and_record)

    return {
        "sessionId": session.id,
        "playlist": _playlist_to_dict(playlist),
        "downloadDir": session.download_dir,
    }


@app.get("/api/download/{session_id}")
async def get_download_session(session_id: str):
    """Return the current snapshot of a download session."""
    session = dl.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "sessionId": session.id,
        "playlist": _playlist_to_dict(session.playlist),
        "downloadDir": session.download_dir,
        "status": session.status,
        "completed": session.completed,
        "total": session.total,
    }


@app.get("/api/sessions")
async def list_sessions():
    """Return all persisted download sessions from the DB."""
    rows = db.get_all_sessions()
    # Enrich still-active sessions with live in-memory track state
    result = []
    for row in rows:
        live = dl.get_session(row["session_id"])
        if live:
            row["tracks"] = [_track_to_dict(t) for t in live.playlist.tracks]
            row["status"] = live.status.value
            row["completed"] = live.completed
        result.append(row)
    return result


@app.delete("/api/sessions/{session_id}")
async def remove_session(session_id: str):
    """Remove a finished session from the DB."""
    db.delete_session(session_id)
    return {"deleted": True, "sessionId": session_id}


@app.get("/api/download/{session_id}/stream")
async def stream_download(session_id: str):
    """SSE stream for real-time download progress."""
    session = dl.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():
        async for update in dl.stream_progress(session):
            yield {"data": json.dumps(update)}

    return EventSourceResponse(event_generator())


@app.delete("/api/download/{session_id}")
async def cancel_download(session_id: str):
    """Cancel a running download session."""
    session = dl.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.cancel()
    return {"cancelled": True, "sessionId": session_id}


@app.get("/api/config")
async def get_config():
    """Legacy endpoint — returns current download_dir from DB."""
    return {"downloadDir": db.get_setting("download_dir") or DEFAULT_DOWNLOAD_DIR}


class ConfigUpdate(BaseModel):
    downloadDir: str


@app.put("/api/config")
async def update_config(body: ConfigUpdate):
    if not body.downloadDir or not body.downloadDir.strip():
        raise HTTPException(status_code=400, detail="downloadDir is required")
    db.set_setting("download_dir", body.downloadDir.strip())
    return {"downloadDir": body.downloadDir.strip()}


# ─── Settings endpoints ──────────────────────────────────────────────────


@app.get("/api/settings")
async def get_settings():
    """Return all persisted settings as a flat key/value object."""
    raw = db.get_all_settings()
    return {
        "downloadDir": raw.get("download_dir", DEFAULT_DOWNLOAD_DIR),
        "plexUrl": raw.get("plex_url", ""),
        "plexToken": raw.get("plex_token", ""),
        "plexLibrarySectionId": raw.get("plex_library_section_id", ""),
    }


class SettingsUpdate(BaseModel):
    downloadDir: str
    plexUrl: str = ""
    plexToken: str = ""
    plexLibrarySectionId: str = ""


@app.put("/api/settings")
async def update_settings(body: SettingsUpdate):
    """Persist one or more settings."""
    if not body.downloadDir or not body.downloadDir.strip():
        raise HTTPException(status_code=400, detail="downloadDir is required")
    db.set_setting("download_dir", body.downloadDir.strip())
    db.set_setting("plex_url", body.plexUrl.strip())
    db.set_setting("plex_token", body.plexToken.strip())
    db.set_setting("plex_library_section_id", body.plexLibrarySectionId.strip())
    return {
        "downloadDir": body.downloadDir.strip(),
        "plexUrl": body.plexUrl.strip(),
        "plexToken": body.plexToken.strip(),
        "plexLibrarySectionId": body.plexLibrarySectionId.strip(),
    }


# ─── Plex endpoints ───────────────────────────────────────────────────────


def _plex_get(plex_url: str, token: str, path: str) -> bytes:
    """Make an authenticated GET request to the Plex API.
    Ignores SSL cert errors so self-signed home-server certs work.
    """
    url = f"{plex_url.rstrip('/')}{path}"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={
        "X-Plex-Token": token,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
        return resp.read()


@app.get("/api/plex/libraries")
def get_plex_libraries():
    """Return all Plex library sections using the stored URL and token."""
    plex_url = db.get_setting("plex_url") or ""
    plex_token = db.get_setting("plex_token") or ""
    if not plex_url or not plex_token:
        raise HTTPException(
            status_code=400,
            detail="Plex URL and token must be saved in settings first",
        )
    try:
        raw = _plex_get(plex_url, plex_token, "/library/sections")
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail=f"Plex error {exc.code}: {exc.reason}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Plex server: {exc}")

    data = json.loads(raw)
    sections = data.get("MediaContainer", {}).get("Directory", [])
    return [{"id": s["key"], "title": s["title"], "type": s["type"]} for s in sections]


@app.post("/api/plex/scan")
def trigger_plex_scan():
    """Trigger a metadata refresh on the configured Plex library section."""
    plex_url = db.get_setting("plex_url") or ""
    plex_token = db.get_setting("plex_token") or ""
    section_id = db.get_setting("plex_library_section_id") or ""
    if not plex_url or not plex_token:
        raise HTTPException(
            status_code=400,
            detail="Plex URL and token must be saved in settings first",
        )
    if not section_id:
        raise HTTPException(
            status_code=400,
            detail="No Plex library section selected — save settings first",
        )
    try:
        _plex_get(plex_url, plex_token, f"/library/sections/{section_id}/refresh")
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=exc.code, detail=f"Plex error {exc.code}: {exc.reason}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Plex server: {exc}")

    return {"triggered": True, "sectionId": section_id}


@app.get("/api/list-dir")
async def list_dir(path: str | None = None):
    """
    Return the subdirectories of a given path (defaults to the user's home
    directory).  Used by the browser-based folder picker so it works on
    remote/headless servers without a GUI.
    """
    base = Path(path) if path else Path.home()
    # Walk up to the nearest existing ancestor so the picker can still open
    # when the requested path (e.g. a not-yet-created download dir) is missing.
    while not (base.exists() and base.is_dir()):
        parent = base.parent
        if parent == base:
            base = Path.home()
            break
        base = parent

    try:
        dirs = sorted(
            [str(p) for p in base.iterdir() if p.is_dir() and not p.name.startswith('.')],
            key=lambda p: p.lower(),
        )
    except PermissionError:
        dirs = []

    parent = str(base.parent) if base.parent != base else None
    return {"current": str(base), "parent": parent, "dirs": dirs}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/history")
async def get_history():
    """Return recent download history (most recent first)."""
    return db.get_history(limit=50)


# ─── DLoad endpoints ─────────────────────────────────────────────────────

# In production the frontend and backend share one origin (nginx proxies /api
# to the backend), so a single PUBLIC_BASE_URL drives both the OAuth callback
# and the post-auth frontend redirect.  When unset, fall back to dev URLs where
# the backend (8000) and Vite frontend (5173) run on separate ports.
if PUBLIC_BASE_URL:
    _DLOAD_CALLBACK = f"{PUBLIC_BASE_URL}/api/dload/oauth-callback"
    _FRONTEND_DLOAD = f"{PUBLIC_BASE_URL}/dload"
else:
    _DLOAD_CALLBACK = "http://localhost:8000/api/dload/oauth-callback"
    _FRONTEND_DLOAD = "http://localhost:5173/dload"


@app.get("/api/dload/status")
async def dload_status():
    """Report whether client_secrets.json is present and OAuth credentials
    have already been stored."""
    has_secrets = dl_dload.client_secrets_exist()
    creds_json  = db.get_setting("dload_credentials")
    authorized  = bool(creds_json and dl_dload.credentials_valid())
    return {
        "hasClientSecrets": has_secrets,
        "authorized": authorized,
    }


@app.get("/api/dload/auth-url")
async def dload_auth_url():
    """Return the Google OAuth authorization URL."""
    if not dl_dload.client_secrets_exist():
        raise HTTPException(
            status_code=400,
            detail="client_secrets.json not found in backend directory",
        )
    auth_url = dl_dload.get_auth_url(_DLOAD_CALLBACK)
    return {"authUrl": auth_url}


@app.get("/api/dload/oauth-callback")
async def dload_oauth_callback(request: Request, code: str = Query(None), error: str = Query(None)):
    """Receive the OAuth redirect, exchange the code and store credentials."""
    if error:
        return RedirectResponse(url=f"{_FRONTEND_DLOAD}?auth=error&detail={error}", status_code=302)
    if not code:
        return RedirectResponse(url=f"{_FRONTEND_DLOAD}?auth=error&detail=missing_code", status_code=302)
    try:
        creds_json = dl_dload.exchange_oauth_code(code, _DLOAD_CALLBACK)
        db.set_setting("dload_credentials", creds_json)
    except Exception as exc:
        return RedirectResponse(url=f"{_FRONTEND_DLOAD}?auth=error&detail={str(exc)}", status_code=302)
    return RedirectResponse(url=f"{_FRONTEND_DLOAD}?auth=success", status_code=302)


@app.post("/api/dload/start")
async def dload_start(background_tasks: BackgroundTasks):
    """Create a DLoad session and start the background process."""
    creds_json = db.get_setting("dload_credentials")
    if not creds_json or not dl_dload.credentials_valid():
        raise HTTPException(status_code=401, detail="Not authorized — complete Google OAuth first")

    download_dir = db.get_setting("download_dir") or DEFAULT_DOWNLOAD_DIR
    loop = asyncio.get_running_loop()
    session = dl_dload.create_session(loop)

    async def _run():
        await dl_dload.run_dload(session, download_dir, creds_json)

    background_tasks.add_task(_run)
    return {"started": True}


@app.get("/api/dload/stream")
async def dload_stream():
    """SSE stream of log messages from the active DLoad session."""
    session = dl_dload.get_active_session()
    if not session:
        raise HTTPException(status_code=404, detail="No active DLoad session")

    async def _generator():
        async for msg in session.stream():
            yield {"data": json.dumps(msg)}

    return EventSourceResponse(_generator())


@app.post("/api/dload/stop")
async def dload_stop():
    """Cancel the currently running DLoad session."""
    session = dl_dload.get_active_session()
    if not session:
        raise HTTPException(status_code=404, detail="No active DLoad session")
    session.cancel()
    return {"stopped": True}
