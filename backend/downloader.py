"""
Downloader module — wraps yt-dlp to fetch playlist metadata and
orchestrate downloads with real-time progress reporting.
"""

from __future__ import annotations

import asyncio
import copy
import re
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import AsyncGenerator, Callable

import yt_dlp

from config import DEFAULT_DOWNLOAD_DIR, YT_DLP_BASE_OPTIONS


class TrackStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    DONE = "done"
    ERROR = "error"
    SKIPPED = "skipped"


class DownloadStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass
class TrackInfo:
    index: int
    id: str
    title: str
    url: str
    thumbnail: str | None = None
    duration: int | None = None  # seconds
    status: TrackStatus = TrackStatus.QUEUED
    progress: float = 0.0  # 0–100
    error: str | None = None


@dataclass
class PlaylistInfo:
    id: str
    title: str
    url: str
    channel: str | None
    thumbnail: str | None
    tracks: list[TrackInfo]


@dataclass
class DownloadSession:
    id: str
    playlist: PlaylistInfo
    download_dir: str
    status: DownloadStatus = DownloadStatus.PENDING
    completed: int = 0
    total: int = 0
    current_track_index: int = 0
    # Asyncio event used to signal new progress events
    _event: asyncio.Event = field(default_factory=asyncio.Event)
    # Cancellation flag
    _cancelled: bool = False
    # Queue of progress dicts for SSE consumers
    _updates: list[dict] = field(default_factory=list)
    # Optional callback invoked after each track completes / session ends
    _persist: Callable[["DownloadSession"], None] | None = field(default=None)

    def push_update(self, data: dict) -> None:
        self._updates.append(data)
        self._event.set()

    def cancel(self) -> None:
        self._cancelled = True


# ─── In-memory session store ───────────────────────────────────────────────

_sessions: dict[str, DownloadSession] = {}


def get_session(session_id: str) -> DownloadSession | None:
    return _sessions.get(session_id)


def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


# ─── Metadata fetching ────────────────────────────────────────────────────


def _best_thumbnail(info: dict) -> str | None:
    """Return the best-quality thumbnail URL from an info dict."""
    url = info.get("thumbnail")
    if url:
        return url
    thumbs = info.get("thumbnails") or []
    if not thumbs:
        return None
    # Pick highest resolution available
    best = max(thumbs, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))
    return best.get("url")


def _sanitize_folder_name(name: str) -> str:
    """Remove / replace characters that are invalid in directory names."""
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = name.strip(". ")
    return name or "playlist"


def fetch_playlist_info(url: str) -> PlaylistInfo:
    """Fetch playlist metadata (no download).  Raises on error."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "ignoreerrors": True,
        "http_headers": YT_DLP_BASE_OPTIONS["http_headers"],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        raise ValueError("Could not fetch playlist information. Check the URL.")

    entries = info.get("entries") or []
    tracks: list[TrackInfo] = []
    for idx, entry in enumerate(entries):
        if not entry:
            continue
        tracks.append(
            TrackInfo(
                index=idx,
                id=entry.get("id", str(idx)),
                title=entry.get("title") or f"Track {idx + 1}",
                url=entry.get("url") or entry.get("webpage_url") or "",
                thumbnail=_best_thumbnail(entry),
                duration=entry.get("duration"),
            )
        )

    # Prefer the first track's thumbnail — the playlist-level thumbnail from
    # YouTube is often the generic "empty playlist" placeholder image.
    first_track_thumb = tracks[0].thumbnail if tracks else None
    playlist_thumb = first_track_thumb or _best_thumbnail(info)

    return PlaylistInfo(
        id=info.get("id", str(uuid.uuid4())),
        title=info.get("title") or "Unknown Playlist",
        url=url,
        channel=info.get("uploader") or info.get("channel"),
        thumbnail=playlist_thumb,
        tracks=tracks,
    )

def create_download_session(playlist: PlaylistInfo, download_dir: str | None = None) -> DownloadSession:
    session_id = str(uuid.uuid4())
    folder = _sanitize_folder_name(playlist.title)
    base_dir = download_dir or DEFAULT_DOWNLOAD_DIR
    dest = str(Path(base_dir) / folder)

    session = DownloadSession(
        id=session_id,
        playlist=playlist,
        download_dir=dest,
        total=len(playlist.tracks),
    )
    _sessions[session_id] = session
    return session


async def run_download(session: DownloadSession) -> None:
    """Run the download in an executor thread to avoid blocking the event loop."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _blocking_download, session)


def _blocking_download(session: DownloadSession) -> None:
    """Synchronous download — runs in a thread pool executor."""
    dest_dir = Path(session.download_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    session.status = DownloadStatus.RUNNING
    session.push_update({"type": "status", "status": DownloadStatus.RUNNING})

    tracks = session.playlist.tracks

    for track in tracks:
        if session._cancelled:
            break

        track.status = TrackStatus.DOWNLOADING
        session.current_track_index = track.index
        session.push_update({
            "type": "track_start",
            "trackIndex": track.index,
            "trackTitle": track.title,
        })

        try:
            _download_single_track(track, session, dest_dir)
            track.status = TrackStatus.DONE
            track.progress = 100.0
        except Exception as exc:
            track.status = TrackStatus.ERROR
            track.error = str(exc)
            session.push_update({
                "type": "track_error",
                "trackIndex": track.index,
                "trackTitle": track.title,
                "error": str(exc),
            })
            continue

        session.completed += 1
        session.push_update({
            "type": "track_done",
            "trackIndex": track.index,
            "trackTitle": track.title,
            "completed": session.completed,
            "total": session.total,
        })
        if session._persist:
            session._persist(session)

    if session._cancelled:
        session.status = DownloadStatus.CANCELLED
        session.push_update({"type": "status", "status": DownloadStatus.CANCELLED})
    else:
        session.status = DownloadStatus.DONE
        session.push_update({
            "type": "status",
            "status": DownloadStatus.DONE,
            "downloadDir": str(dest_dir),
        })
    if session._persist:
        session._persist(session)


def _download_single_track(track: TrackInfo, session: DownloadSession, dest_dir: Path) -> None:
    opts = copy.deepcopy(YT_DLP_BASE_OPTIONS)
    opts["outtmpl"] = str(dest_dir / "%(title)s.%(ext)s")

    def progress_hook(d: dict) -> None:
        if session._cancelled:
            raise yt_dlp.utils.DownloadCancelled()

        status = d.get("status")
        if status == "downloading":
            downloaded = d.get("downloaded_bytes", 0) or 0
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = (downloaded / total * 100) if total else 0
            track.progress = pct
            session.push_update({
                "type": "track_progress",
                "trackIndex": track.index,
                "progress": round(pct, 1),
            })
        elif status == "finished":
            track.progress = 100.0

    opts["progress_hooks"] = [progress_hook]

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([track.url])


# ─── SSE generator ──────────────────────────────────────────────────────


async def stream_progress(session: DownloadSession) -> AsyncGenerator[dict, None]:
    """Async generator that yields progress dicts for SSE streaming."""
    sent_index = 0

    while True:
        # Drain any pending updates
        while sent_index < len(session._updates):
            yield session._updates[sent_index]
            sent_index += 1

        # If session is terminal, stop
        if session.status in (DownloadStatus.DONE, DownloadStatus.CANCELLED, DownloadStatus.ERROR):
            break

        # Wait for new updates
        session._event.clear()
        try:
            await asyncio.wait_for(session._event.wait(), timeout=15.0)
        except asyncio.TimeoutError:
            # Send a heartbeat so the SSE connection stays alive
            yield {"type": "heartbeat"}
