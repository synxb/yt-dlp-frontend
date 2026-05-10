"""
Persistent settings store using SQLite3 (stdlib — no extra dependencies).

The DB file lives next to this module: backend/settings.db
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from config import DEFAULT_DOWNLOAD_DIR

_DB_PATH = Path(__file__).parent / "settings.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create all tables if they don't exist and seed defaults."""
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        # Seed default download dir only if the row doesn't exist yet
        conn.execute(
            """
            INSERT OR IGNORE INTO settings (key, value)
            VALUES ('download_dir', ?)
            """,
            (DEFAULT_DOWNLOAD_DIR,),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS download_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id   TEXT NOT NULL,
                title         TEXT NOT NULL,
                url           TEXT NOT NULL,
                channel       TEXT,
                thumbnail     TEXT,
                track_count   INTEGER NOT NULL DEFAULT 0,
                download_dir  TEXT,
                completed_at  TEXT NOT NULL
                              DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS download_sessions (
                session_id   TEXT PRIMARY KEY,
                playlist_id  TEXT NOT NULL,
                title        TEXT NOT NULL,
                url          TEXT NOT NULL,
                channel      TEXT,
                thumbnail    TEXT,
                download_dir TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                completed    INTEGER NOT NULL DEFAULT 0,
                total        INTEGER NOT NULL DEFAULT 0,
                tracks_json  TEXT NOT NULL DEFAULT '[]',
                added_at     TEXT NOT NULL
                             DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )
            """
        )
        conn.commit()
    # Remove sessions that finished successfully — they're no longer needed.
    delete_done_sessions()


def get_setting(key: str) -> str | None:
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with _get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()


def get_all_settings() -> dict[str, str]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


# ─── Download history ───────────────────────────────────────────────────


def add_history_entry(
    playlist_id: str,
    title: str,
    url: str,
    track_count: int,
    channel: str | None = None,
    thumbnail: str | None = None,
    download_dir: str | None = None,
) -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO download_history
                (playlist_id, title, url, channel, thumbnail, track_count, download_dir)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (playlist_id, title, url, channel, thumbnail, track_count, download_dir),
        )
        conn.commit()


def get_history(limit: int = 50) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, playlist_id, title, url, channel, thumbnail,
                   track_count, download_dir, completed_at
            FROM download_history
            ORDER BY completed_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


# ─── Download sessions ──────────────────────────────────────────────────


def upsert_session(
    session_id: str,
    playlist_id: str,
    title: str,
    url: str,
    channel: str | None,
    thumbnail: str | None,
    download_dir: str,
    status: str,
    completed: int,
    total: int,
    tracks: list[dict],
) -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO download_sessions
                (session_id, playlist_id, title, url, channel, thumbnail,
                 download_dir, status, completed, total, tracks_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                status       = excluded.status,
                completed    = excluded.completed,
                tracks_json  = excluded.tracks_json,
                download_dir = excluded.download_dir
            """,
            (
                session_id, playlist_id, title, url, channel, thumbnail,
                download_dir, status, completed, total, json.dumps(tracks),
            ),
        )
        conn.commit()


def get_all_sessions() -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT session_id, playlist_id, title, url, channel, thumbnail,
                   download_dir, status, completed, total, tracks_json, added_at
            FROM download_sessions
            ORDER BY added_at DESC
            """
        ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["tracks"] = json.loads(d.pop("tracks_json"))
        result.append(d)
    return result


def delete_session(session_id: str) -> None:
    with _get_conn() as conn:
        conn.execute(
            "DELETE FROM download_sessions WHERE session_id = ?", (session_id,)
        )
        conn.commit()


def delete_done_sessions() -> None:
    """Remove all sessions with status 'done' from the database."""
    with _get_conn() as conn:
        conn.execute("DELETE FROM download_sessions WHERE status = 'done'")
        conn.commit()
