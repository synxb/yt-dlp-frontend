import type { DownloadStatus, PlaylistInfo, ProgressEvent } from './types';

const BASE = 'http://localhost:8000';

export async function fetchPlaylist(url: string): Promise<PlaylistInfo> {
  const res = await fetch(`${BASE}/api/playlist?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail ?? 'Failed to fetch playlist');
  }
  return res.json();
}

export async function startDownload(
  playlistUrl: string,
  downloadDir?: string,
  trackIds?: string[],
): Promise<{ sessionId: string; playlist: PlaylistInfo; downloadDir: string }> {
  const res = await fetch(`${BASE}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistUrl, downloadDir, trackIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail ?? 'Failed to start download');
  }
  return res.json();
}

export function createProgressStream(
  sessionId: string,
  onEvent: (e: ProgressEvent) => void,
  onError?: (err: Event) => void,
): EventSource {
  const es = new EventSource(`${BASE}/api/download/${sessionId}/stream`);
  es.onmessage = (event) => {
    try {
      const data: ProgressEvent = JSON.parse(event.data);
      onEvent(data);
    } catch {
      // ignore malformed events
    }
  };
  if (onError) es.onerror = onError;
  return es;
}

export async function cancelDownload(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/download/${sessionId}`, { method: 'DELETE' });
}

export interface SessionSnapshot {
  sessionId: string;
  playlist: PlaylistInfo;
  downloadDir: string;
  status: DownloadStatus;
  completed: number;
  total: number;
}

export async function getDownloadSession(sessionId: string): Promise<SessionSnapshot> {
  const res = await fetch(`${BASE}/api/download/${sessionId}`);
  if (!res.ok) throw new Error('Session not found');
  return res.json();
}

// ─── Persisted sessions ───────────────────────────────────────────────

export interface PersistedSession {
  session_id: string;
  playlist_id: string;
  title: string;
  url: string;
  channel: string | null;
  thumbnail: string | null;
  download_dir: string;
  status: DownloadStatus;
  completed: number;
  total: number;
  tracks: import('./types').TrackInfo[];
  added_at: string;
}

export async function listSessions(): Promise<PersistedSession[]> {
  const res = await fetch(`${BASE}/api/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function removeSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function getConfig(): Promise<{ downloadDir: string }> {
  const res = await fetch(`${BASE}/api/config`);
  return res.json();
}

/**
 * List subdirectories of a path on the server (defaults to home directory).
 * Used by the browser-based folder picker.
 */
export async function listDir(path?: string): Promise<{ current: string; parent: string | null; dirs: string[] }> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${BASE}/api/list-dir${params}`);
  if (!res.ok) throw new Error('Failed to list directory');
  return res.json();
}

export async function updateConfig(downloadDir: string): Promise<{ downloadDir: string }> {
  const res = await fetch(`${BASE}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadDir }),
  });
  return res.json();
}

// ─── Settings (persisted in SQLite) ──────────────────────────────────────

export interface Settings {
  downloadDir: string;
  plexUrl: string;
  plexToken: string;
  plexLibrarySectionId: string;
}

export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

// ─── Download history ─────────────────────────────────────────────────

export interface HistoryEntry {
  id: number;
  playlist_id: string;
  title: string;
  url: string;
  channel: string | null;
  thumbnail: string | null;
  track_count: number;
  download_dir: string | null;
  completed_at: string;
}

export async function getDownloadHistory(): Promise<HistoryEntry[]> {
  const res = await fetch(`${BASE}/api/history`);
  if (!res.ok) throw new Error('Failed to load history');
  return res.json();
}


export interface PlexLibrary {
  id: string;
  title: string;
  type: string;
}

export async function getPlexLibraries(): Promise<PlexLibrary[]> {
  const res = await fetch(`${BASE}/api/plex/libraries`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail ?? 'Failed to fetch Plex libraries');
  }
  return res.json();
}

export async function triggerPlexScan(): Promise<void> {
  const res = await fetch(`${BASE}/api/plex/scan`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail ?? 'Failed to trigger Plex scan');
  }
}
