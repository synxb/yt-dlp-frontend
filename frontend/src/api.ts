import type { PlaylistInfo, ProgressEvent } from './types';

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
): Promise<{ sessionId: string; playlist: PlaylistInfo; downloadDir: string }> {
  const res = await fetch(`${BASE}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlistUrl, downloadDir }),
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

export async function getConfig(): Promise<{ downloadDir: string }> {
  const res = await fetch(`${BASE}/api/config`);
  return res.json();
}

/**
 * Ask the host machine to open a native OS directory-picker dialog.
 * Returns the chosen path, or null if the user cancelled.
 */
export async function browseFolder(initialDir?: string): Promise<string | null> {
  const params = initialDir ? `?initialDir=${encodeURIComponent(initialDir)}` : '';
  const res = await fetch(`${BASE}/api/browse-folder${params}`);
  if (res.status === 204) return null; // user cancelled
  if (!res.ok) throw new Error('Failed to open folder dialog');
  const data = await res.json();
  return data.path ?? null;
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
