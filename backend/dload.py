"""DLoad module — downloads the "Music To Download" playlist and wipes it.

SSE event shapes emitted via DLoadSession.emit():
  {"type": "log",            "level": "info|warning|error|success", "message": "..."}
  {"type": "track_start",    "index": N, "title": "...", "total": N}
  {"type": "track_progress", "index": N, "progress": 0-100}
  {"type": "track_done",     "index": N}
  {"type": "track_error",    "index": N, "error": "..."}
  {"type": "heartbeat"}
  {"type": "cancelled"}
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path

import yt_dlp
from mutagen.mp3 import MP3

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from google.auth.exceptions import RefreshError
import google_auth_oauthlib.flow
import googleapiclient.discovery

import database

# ─── Constants ───────────────────────────────────────────────────────────

PLAYLIST_ID = "PL9_ZzSLZWZOOObtmstDtpcr66oOCrO8ot"
PLAYLIST_URL = f"https://www.youtube.com/playlist?list={PLAYLIST_ID}"
SCOPES = ["https://www.googleapis.com/auth/youtube"]

BROKEN_LENGTH = 300.048
BROKEN_THRESHOLD = 0.01

_BACKEND_DIR = Path(__file__).parent
CLIENT_SECRETS_PATH = _BACKEND_DIR / "client_secrets.json"

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\r")


def _strip(text: str) -> str:
    return _ANSI_RE.sub("", text).strip()


# ─── OAuth helpers ────────────────────────────────────────────────────────

_pending_flow: google_auth_oauthlib.flow.Flow | None = None


class CredentialsExpired(Exception):
    """Raised when the stored refresh token is no longer valid.

    The caller should prompt the user to re-run the Google OAuth flow.
    """


def client_secrets_exist() -> bool:
    return CLIENT_SECRETS_PATH.is_file()


def get_auth_url(redirect_uri: str) -> str:
    global _pending_flow
    _pending_flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
        str(CLIENT_SECRETS_PATH),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    auth_url, _ = _pending_flow.authorization_url(
        access_type="offline", prompt="consent"
    )
    return auth_url


def exchange_oauth_code(code: str, redirect_uri: str) -> str:
    """Exchange auth code for credentials; returns JSON string."""
    global _pending_flow
    if _pending_flow is None:
        raise RuntimeError("No pending OAuth flow")
    _pending_flow.redirect_uri = redirect_uri
    _pending_flow.fetch_token(code=code)
    creds = _pending_flow.credentials
    _pending_flow = None
    creds_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
    }
    return json.dumps(creds_data)


def credentials_valid() -> bool:
    creds_json = database.get_setting("dload_credentials")
    if not creds_json:
        return False
    try:
        _load_credentials(creds_json)
        return True
    except Exception:
        return False


def _load_credentials(creds_json: str) -> Credentials:
    data = json.loads(creds_json)
    creds = Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=data.get("scopes"),
    )
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleRequest())
        except RefreshError as exc:
            # The refresh token has been revoked or expired (common when the
            # Google OAuth consent screen is in "Testing" mode, where refresh
            # tokens expire after 7 days). Drop the stale credentials so the
            # app reports "not authorized" and prompts a fresh OAuth flow.
            database.set_setting("dload_credentials", "")
            raise CredentialsExpired(
                "Google authorization has expired. Please re-connect your "
                "Google account from the DLoad page."
            ) from exc
        updated = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": list(creds.scopes or []),
        }
        database.set_setting("dload_credentials", json.dumps(updated))
    return creds


def _fetch_all_playlist_items(youtube) -> list[dict]:
    """Return every item in the DLoad playlist, following pagination.

    Uses the authenticated Data API so all items the account can see are
    included — yt-dlp's anonymous extraction silently drops many videos and
    only returns a partial list.
    """
    items: list[dict] = []
    page_token: str | None = None
    while True:
        response = (
            youtube.playlistItems()
            .list(
                part="contentDetails,snippet",
                playlistId=PLAYLIST_ID,
                maxResults=50,
                pageToken=page_token,
            )
            .execute()
        )
        items.extend(response.get("items", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return items


# ─── DLoad session ────────────────────────────────────────────────────────

_SENTINEL = object()  # signals end-of-stream


class DLoadSession:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._updates: list = []
        self._event: asyncio.Event = asyncio.Event()
        self._cancelled = False

    def _push(self, item: object) -> None:
        """Append item and wake up the stream coroutine (thread-safe)."""
        self._updates.append(item)
        self._loop.call_soon_threadsafe(self._event.set)

    def emit(self, event: dict) -> None:
        self._push(event)

    def log(self, message: str, level: str = "info") -> None:
        self.emit({"type": "log", "level": level, "message": _strip(message)})

    def track_start(self, index: int, title: str, total: int) -> None:
        self.emit({"type": "track_start", "index": index, "title": title, "total": total})

    def track_progress(self, index: int, progress: float) -> None:
        self.emit({"type": "track_progress", "index": index, "progress": progress})

    def track_done(self, index: int) -> None:
        self.emit({"type": "track_done", "index": index})

    def track_error(self, index: int, error: str) -> None:
        self.emit({"type": "track_error", "index": index, "error": _strip(error)})

    def cancel(self) -> None:
        self._cancelled = True

    def finish(self) -> None:
        self._push(_SENTINEL)

    async def stream(self):
        """Async generator that yields event dicts until session ends.

        Uses the same list+Event pattern as DownloadSession.stream_progress so
        there is no asyncio.Queue race condition when items arrive at timeout
        boundaries.
        """
        idx = 0
        while True:
            # Drain everything already in the list
            while idx < len(self._updates):
                item = self._updates[idx]
                idx += 1
                if item is _SENTINEL:
                    return
                yield item

            # Clear the event, then re-check the list to avoid a missed-wakeup
            # race: a worker thread may have appended + called set() between
            # our drain loop and this clear().
            self._event.clear()
            if idx < len(self._updates):
                continue  # pick up the item(s) on next iteration

            # Wait for more events or yield a heartbeat on timeout
            try:
                await asyncio.wait_for(self._event.wait(), timeout=15)
            except asyncio.TimeoutError:
                yield {"type": "heartbeat"}


# ─── Module-level session management ─────────────────────────────────────

_active_session: DLoadSession | None = None


def get_active_session() -> DLoadSession | None:
    return _active_session


def create_session(loop: asyncio.AbstractEventLoop) -> DLoadSession:
    global _active_session
    _active_session = DLoadSession(loop)
    return _active_session


# ─── Runner ───────────────────────────────────────────────────────────────


async def run_dload(
    session: DLoadSession, download_dir: str, creds_json: str
) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, _run_dload_sync, session, download_dir, creds_json
    )


def _run_dload_sync(
    session: DLoadSession, download_dir: str, creds_json: str
) -> None:
    try:
        # ── 1. Create date folder ─────────────────────────────────────────
        date_str = datetime.now().strftime("%Y-%m-%d")
        date_folder = Path(download_dir) / "Various Artists" / date_str
        date_folder.mkdir(parents=True, exist_ok=True)
        session.log(f"Download folder: {date_folder}")

        if session._cancelled:
            session.emit({"type": "cancelled"})
            return

        # ── 2. Fetch playlist items via the authenticated Data API ───────
        # Use the API (not yt-dlp's anonymous flat extraction) so we get every
        # item the account can see — anonymous extraction only returned a
        # partial list.
        session.log("Fetching playlist info…")
        creds = _load_credentials(creds_json)
        youtube = googleapiclient.discovery.build(
            "youtube", "v3", credentials=creds, cache_discovery=False
        )
        all_items = _fetch_all_playlist_items(youtube)

        total = len(all_items)
        if total == 0:
            session.log("Playlist is empty", "warning")
            return

        session.log(f"Found {total} track(s)")

        # Pre-populate ALL tracks immediately so the frontend shows the full
        # list before any download begins.
        tracks_info: list[tuple[int, str, str]] = []
        for i, item in enumerate(all_items):
            title = item["snippet"]["title"]
            video_id = item["contentDetails"]["videoId"]
            url = f"https://www.youtube.com/watch?v={video_id}"
            tracks_info.append((i, title, url))
            session.track_start(i, title, total)

        if session._cancelled:
            session.emit({"type": "cancelled"})
            return

        # ── 3. Download each track individually ───────────────────────────
        # Downloading one URL at a time (like the queue downloader) lets us:
        #   • check _cancelled cleanly between tracks
        #   • raise DownloadCancelled from the hook to abort only the current
        #     track — it is NOT swallowed by an outer playlist loop
        dl_opts: dict = {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "outtmpl": str(date_folder / "%(title)s.%(ext)s"),
            "no_color": True,
            "quiet": False,
            "ignoreerrors": False,  # must NOT swallow DownloadCancelled
        }

        for i, title, url in tracks_info:
            if session._cancelled:
                session.emit({"type": "cancelled"})
                return

            def _make_hook(track_idx: int):
                def _hook(d: dict) -> None:
                    if session._cancelled:
                        raise yt_dlp.utils.DownloadCancelled()
                    status = d.get("status")
                    if status == "downloading":
                        downloaded = d.get("downloaded_bytes") or 0
                        total_b = d.get("total_bytes") or d.get("total_bytes_estimate") or 1
                        progress = min(100.0, downloaded / total_b * 100)
                        session.track_progress(track_idx, round(progress, 1))
                return _hook

            track_opts = dict(dl_opts)
            track_opts["progress_hooks"] = [_make_hook(i)]
            try:
                with yt_dlp.YoutubeDL(track_opts) as ydl:
                    ydl.download([url])
                session.track_done(i)
            except yt_dlp.utils.DownloadCancelled:
                session.emit({"type": "cancelled"})
                return
            except Exception as exc:
                session.track_error(i, str(exc))
                # Continue to the next track

        if session._cancelled:
            session.emit({"type": "cancelled"})
            return

        # ── 4. Validate MP3 files ─────────────────────────────────────────
        session.log("Validating downloaded files…")
        mp3_files = list(date_folder.glob("*.mp3"))
        session.log(f"Found {len(mp3_files)} MP3 file(s)")

        broken_titles: set[str] = set()
        for mp3_file in mp3_files:
            if session._cancelled:
                session.emit({"type": "cancelled"})
                return
            try:
                audio = MP3(str(mp3_file))
                length = audio.info.length
                if abs(length - BROKEN_LENGTH) <= BROKEN_THRESHOLD:
                    session.log(
                        f"BROKEN ({length:.3f}s): {mp3_file.name}", "warning"
                    )
                    broken_titles.add(mp3_file.stem)
                else:
                    session.log(f"OK ({length:.1f}s): {mp3_file.name}")
            except Exception as exc:
                session.log(f"Error reading {mp3_file.name}: {exc}", "error")

        # ── 5. Wipe playlist ──────────────────────────────────────────────
        # Re-fetch the current items so deletions reflect the latest state.
        session.log("Fetching playlist items…")
        all_items = _fetch_all_playlist_items(youtube)

        session.log(f"Found {len(all_items)} playlist item(s)")

        deleted = 0
        kept = 0
        for item in all_items:
            if session._cancelled:
                session.emit({"type": "cancelled"})
                return
            title = item["snippet"]["title"]
            if title not in broken_titles:
                session.log(f"Deleting: {title}")
                try:
                    youtube.playlistItems().delete(id=item["id"]).execute()
                    deleted += 1
                except Exception as exc:
                    session.log(f"Error deleting '{title}': {exc}", "error")
            else:
                session.log(f"Keeping (broken): {title}", "warning")
                kept += 1

        session.log(
            f"Complete — {deleted} item(s) removed, {kept} kept (broken).",
            "success",
        )

    except CredentialsExpired as exc:
        session.log(str(exc), "error")
    except RefreshError:
        # A lazy token refresh triggered by the API client failed (the stored
        # token has no expiry, so google-api-client refreshes on first use and
        # can raise invalid_grant here rather than in _load_credentials). Drop
        # the stale credentials and prompt the user to re-authorize.
        database.set_setting("dload_credentials", "")
        session.log(
            "Google authorization has expired. Please re-connect your "
            "Google account from the DLoad page.",
            "error",
        )
    except Exception as exc:
        session.log(f"Fatal error: {exc}", "error")
    finally:
        session.finish()
