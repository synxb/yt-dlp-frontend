import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import type { DLoadLogLine, DLoadPageState, DownloadStatus, PlaylistInfo, ProgressEvent, TrackInfo, QueueItem } from './types';
import { cancelDownload, createProgressStream, fetchPlaylist, getConfig, getDLoadStatus, getDLoadAuthUrl, startDLoad, stopDLoad, createDLoadStream, listSessions, removeSession, startDownload, type DLoadEvent } from './api';
import { URLInputPage } from './pages/URLInputPage';
import { PlaylistPreviewPage } from './pages/PlaylistPreviewPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { DLoadPage } from './pages/DLoadPage';

export default function App() {
  const navigate = useNavigate();

  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [addingToQueue, setAddingToQueue] = useState(false);
  const esRefs = useRef<Map<string, EventSource>>(new Map());

  // ── DLoad state (lifted so it survives navigation) ──────────────────
  const [dloadPageState, setDloadPageState] = useState<DLoadPageState>('checking');
  const [dloadTracks, setDloadTracks] = useState<TrackInfo[]>([]);
  const [dloadLogs, setDloadLogs] = useState<DLoadLogLine[]>([]);
  const [dloadStatusNote, setDloadStatusNote] = useState('');
  const dloadEsRef = useRef<EventSource | null>(null);
  const dloadAuthPopupRef = useRef<Window | null>(null);
  const dloadAuthPollRef = useRef<number | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => setDownloadDir(c.downloadDir))
      .catch(() => setDownloadDir(''));
  }, []);

  // Check DLoad auth status once on mount
  useEffect(() => {
    getDLoadStatus()
      .then((s) => {
        if (!s.hasClientSecrets) setDloadPageState('no_secrets');
        else if (!s.authorized) setDloadPageState('needs_auth');
        else setDloadPageState((cur) => cur === 'checking' ? 'ready' : cur);
      })
      .catch(() => setDloadPageState('needs_auth'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accept OAuth completion messages from the popup callback page.
  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        result?: 'success' | 'error';
        detail?: string;
      };
      if (data?.type !== 'dload-oauth-result') return;

      if (dloadAuthPollRef.current !== null) {
        window.clearInterval(dloadAuthPollRef.current);
        dloadAuthPollRef.current = null;
      }
      dloadAuthPopupRef.current?.close();
      dloadAuthPopupRef.current = null;

      if (data.result === 'success') {
        setDloadPageState('ready');
        setDloadStatusNote('Authorization successful!');
      } else {
        setDloadPageState('needs_auth');
        setDloadStatusNote(`Authorization failed: ${data.detail ?? 'Unknown error'}`);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Cleanup all SSE streams on unmount
  useEffect(() => {
    return () => {
      esRefs.current.forEach((es) => es.close());
      dloadEsRef.current?.close();
      if (dloadAuthPollRef.current !== null) {
        window.clearInterval(dloadAuthPollRef.current);
        dloadAuthPollRef.current = null;
      }
      dloadAuthPopupRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore queue from the DB on mount and re-connect SSE for active sessions
  useEffect(() => {
    listSessions()
      .then((rows) => {
        if (!rows.length) return;

        const items: QueueItem[] = rows.map((row) => ({
          sessionId: row.session_id,
          playlist: {
            id: row.playlist_id,
            title: row.title,
            url: row.url,
            channel: row.channel,
            thumbnail: row.thumbnail,
            tracks: row.tracks,
          },
          tracks: row.tracks,
          downloadStatus: row.status,
          completed: row.completed,
          downloadDir: row.download_dir,
          addedAt: new Date(row.added_at).getTime(),
        }));

        setQueue(items);

        for (const item of items) {
          if (item.downloadStatus === 'running' || item.downloadStatus === 'pending') {
            const es = createProgressStream(item.sessionId, (event) => {
              handleQueueProgressEvent(item.sessionId, event);
            });
            esRefs.current.set(item.sessionId, es);
          }
        }
      })
      .catch(() => {/* backend not yet ready – silently ignore */});
  // handleQueueProgressEvent is stable (useCallback [] deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDownloads = queue.filter(
    (item) => item.downloadStatus === 'running' || item.downloadStatus === 'pending',
  ).length;

  const handleFetch = useCallback(
    async (url: string) => {
      setFetchLoading(true);
      setFetchError(null);
      try {
        const info = await fetchPlaylist(url);
        setPlaylist(info);
        navigate('/preview');
      } catch (err: unknown) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch playlist');
      } finally {
        setFetchLoading(false);
      }
    },
    [navigate],
  );

  const handleQueueProgressEvent = useCallback(
    (sessionId: string, event: ProgressEvent) => {
      if (event.type === 'heartbeat') return;

      setQueue((prev) =>
        prev
          .map((item) => {
            if (item.sessionId !== sessionId) return item;

            const next = { ...item };

          if (event.type === 'status' && event.status) {
            next.downloadStatus = event.status as DownloadStatus;
            if (event.downloadDir) next.downloadDir = event.downloadDir;
            if (
              event.status === 'done' ||
              event.status === 'cancelled' ||
              event.status === 'error'
            ) {
              esRefs.current.get(sessionId)?.close();
              esRefs.current.delete(sessionId);
            }
            if (event.status === 'done') {
              removeSession(sessionId).catch(() => {});
            }
          }

          if (event.type === 'track_start' && event.trackIndex != null) {
            const tracks = [...next.tracks];
            if (tracks[event.trackIndex]) {
              tracks[event.trackIndex] = { ...tracks[event.trackIndex], status: 'downloading' };
            }
            next.tracks = tracks;
          }

          if (event.type === 'track_progress' && event.trackIndex != null) {
            const tracks = [...next.tracks];
            if (tracks[event.trackIndex]) {
              tracks[event.trackIndex] = {
                ...tracks[event.trackIndex],
                progress: event.progress ?? tracks[event.trackIndex].progress,
              };
            }
            next.tracks = tracks;
          }

          if (event.type === 'track_done' && event.trackIndex != null) {
            const tracks = [...next.tracks];
            if (tracks[event.trackIndex]) {
              tracks[event.trackIndex] = {
                ...tracks[event.trackIndex],
                status: 'done',
                progress: 100,
              };
            }
            next.tracks = tracks;
            if (event.completed != null) next.completed = event.completed;
          }

          if (event.type === 'track_error' && event.trackIndex != null) {
            const tracks = [...next.tracks];
            if (tracks[event.trackIndex]) {
              tracks[event.trackIndex] = {
                ...tracks[event.trackIndex],
                status: 'error',
                error: event.error ?? 'Unknown error',
              };
            }
            next.tracks = tracks;
          }

          return next;
          })
          .filter((item) => item.downloadStatus !== 'done'),
      );
    },
    [],
  );

  const handleAddToQueue = useCallback(
    async (dir: string, selectedIds: Set<string>) => {
      if (!playlist) return;
      setAddingToQueue(true);
      try {
        const res = await startDownload(playlist.url, dir, [...selectedIds]);
        const initialTracks: TrackInfo[] = res.playlist.tracks.map((t) => ({
          ...t,
          status: 'queued' as const,
          progress: 0,
          error: null,
        }));

        const queueItem: QueueItem = {
          sessionId: res.sessionId,
          playlist: res.playlist,
          tracks: initialTracks,
          downloadStatus: 'pending',
          completed: 0,
          downloadDir: res.downloadDir,
          addedAt: Date.now(),
        };

        setQueue((prev) => [...prev, queueItem]);

        const es = createProgressStream(res.sessionId, (event: ProgressEvent) => {
          handleQueueProgressEvent(res.sessionId, event);
        });
        esRefs.current.set(res.sessionId, es);

        setPlaylist(null);
        navigate('/queue');
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to start download');
      } finally {
        setAddingToQueue(false);
      }
    },
    [playlist, handleQueueProgressEvent, navigate],
  );

  const handleCancelQueueItem = useCallback(async (sessionId: string) => {
    await cancelDownload(sessionId);
    esRefs.current.get(sessionId)?.close();
    esRefs.current.delete(sessionId);
  }, []);

  const handleClearCompleted = useCallback(() => {
    setQueue((prev) => {
      const toRemove = prev.filter(
        (item) =>
          item.downloadStatus !== 'running' && item.downloadStatus !== 'pending',
      );
      for (const item of toRemove) {
        removeSession(item.sessionId).catch(() => {});
      }
      return prev.filter(
        (item) => item.downloadStatus === 'running' || item.downloadStatus === 'pending',
      );
    });
  }, []);

  const handleOpenFolder = useCallback((dir: string) => {
    if (dir) {
      window.open(`file:///${dir.replace(/\\/g, '/')}`, '_blank');
    }
  }, []);

  // ── DLoad helpers ─────────────────────────────────────────────────
  function makeDLoadTrack(index: number, title: string): TrackInfo {
    return { index, id: String(index), title, url: '', thumbnail: null, duration: null, status: 'queued', progress: 0, error: null };
  }

  const handleDLoadEvent = useCallback((e: DLoadEvent) => {
    switch (e.type) {
      case 'log':
        setDloadLogs((prev) => [...prev, { level: e.level, message: e.message }]);
        break;
      case 'track_start':
        setDloadTracks((prev) => {
          const next = [...prev];
          while (next.length <= e.index) next.push(makeDLoadTrack(next.length, ''));
          next[e.index] = makeDLoadTrack(e.index, e.title);
          return next;
        });
        break;
      case 'track_progress':
        setDloadTracks((prev) =>
          prev.map((t) => t.index === e.index ? { ...t, status: 'downloading', progress: e.progress } : t),
        );
        break;
      case 'track_done':
        setDloadTracks((prev) =>
          prev.map((t) => t.index === e.index ? { ...t, status: 'done', progress: 100 } : t),
        );
        break;
      case 'track_error':
        setDloadTracks((prev) =>
          prev.map((t) => t.index === e.index ? { ...t, status: 'error', error: e.error } : t),
        );
        break;
      case 'cancelled':
        dloadEsRef.current?.close();
        dloadEsRef.current = null;
        setDloadPageState('cancelled');
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDLoadAuthorize = useCallback(async () => {
    try {
      const authUrl = await getDLoadAuthUrl();

      if (dloadAuthPollRef.current !== null) {
        window.clearInterval(dloadAuthPollRef.current);
        dloadAuthPollRef.current = null;
      }
      dloadAuthPopupRef.current?.close();

      const popup = window.open(
        authUrl,
        'dload-google-oauth',
        'popup=yes,width=560,height=700,menubar=no,toolbar=no,status=no,scrollbars=yes,resizable=yes',
      );

      if (!popup) {
        setDloadStatusNote('Popup was blocked by your browser. Opening authorization in this tab...');
        window.location.href = authUrl;
        return;
      }

      dloadAuthPopupRef.current = popup;
      popup.focus();

      dloadAuthPollRef.current = window.setInterval(() => {
        const currentPopup = dloadAuthPopupRef.current;
        if (!currentPopup) return;

        if (currentPopup.closed) {
          if (dloadAuthPollRef.current !== null) {
            window.clearInterval(dloadAuthPollRef.current);
            dloadAuthPollRef.current = null;
          }
          dloadAuthPopupRef.current = null;
          getDLoadStatus()
            .then((s) => {
              if (s.authorized) {
                setDloadPageState('ready');
                setDloadStatusNote('Authorization successful!');
              } else {
                setDloadPageState('needs_auth');
              }
            })
            .catch(() => setDloadPageState('needs_auth'));
          return;
        }

        try {
          const url = new URL(currentPopup.location.href);
          const authResult = url.searchParams.get('auth');
          if (authResult === 'success' || authResult === 'error') {
            if (dloadAuthPollRef.current !== null) {
              window.clearInterval(dloadAuthPollRef.current);
              dloadAuthPollRef.current = null;
            }
            currentPopup.close();
            dloadAuthPopupRef.current = null;

            const detail = url.searchParams.get('detail') ?? undefined;
            if (authResult === 'success') {
              setDloadPageState('ready');
              setDloadStatusNote('Authorization successful!');
            } else {
              setDloadPageState('needs_auth');
              setDloadStatusNote(`Authorization failed: ${detail ?? 'Unknown error'}`);
            }
          }
        } catch {
          // Ignore cross-origin access errors until callback returns to our origin.
        }
      }, 500);
    } catch (err) {
      setDloadStatusNote(err instanceof Error ? err.message : 'Failed to get auth URL');
    }
  }, []);

  const handleDLoadStart = useCallback(async () => {
    setDloadTracks([]);
    setDloadLogs([]);
    setDloadStatusNote('');
    setDloadPageState('running');
    try {
      await startDLoad();
    } catch (err) {
      setDloadStatusNote(err instanceof Error ? err.message : 'Failed to start DLoad');
      setDloadPageState('ready');
      return;
    }
    const es = createDLoadStream(handleDLoadEvent, () => {
      dloadEsRef.current = null;
      setDloadPageState((s) => s === 'running' ? 'done' : s);
    });
    dloadEsRef.current = es;
  }, [handleDLoadEvent]);

  const handleDLoadStop = useCallback(async () => {
    await stopDLoad().catch(() => {});
    dloadEsRef.current?.close();
    dloadEsRef.current = null;
    setDloadPageState('cancelled');
  }, []);

  const handleDLoadReset = useCallback(() => {
    setDloadTracks([]);
    setDloadLogs([]);
    setDloadStatusNote('');
    setDloadPageState('ready');
  }, []);

  const handleDLoadAuthResult = useCallback((result: 'success' | 'error', detail?: string) => {
    if (result === 'error') {
      setDloadStatusNote(`Authorization failed: ${detail ?? 'Unknown error'}`);
    } else {
      setDloadStatusNote('Authorization successful!');
      setDloadPageState('ready');
    }
  }, []);

  const handleOpenSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleSettingsBack = useCallback(() => {
    getConfig()
      .then((c) => setDownloadDir(c.downloadDir))
      .catch(() => {});
    navigate(-1);
  }, [navigate]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <URLInputPage
            onFetch={handleFetch}
            onSettings={handleOpenSettings}
            loading={fetchLoading}
            error={fetchError}
            activeDownloads={activeDownloads}
          />
        }
      />
      <Route
        path="/preview"
        element={
          playlist ? (
            <PlaylistPreviewPage
              playlist={playlist}
              defaultDownloadDir={downloadDir}
              onBack={() => {
                setPlaylist(null);
                navigate('/');
              }}
              onSettings={handleOpenSettings}
              onAddToQueue={handleAddToQueue}
              activeDownloads={activeDownloads}
              loading={addingToQueue}
            />
          ) : (
            <URLInputPage
              onFetch={handleFetch}
              onSettings={handleOpenSettings}
              loading={fetchLoading}
              error={fetchError}
              activeDownloads={activeDownloads}
            />
          )
        }
      />
      <Route
        path="/queue"
        element={
          <QueuePage
            queue={queue}
            onCancel={handleCancelQueueItem}
            onClearCompleted={handleClearCompleted}
            onOpenFolder={handleOpenFolder}
            onSettings={handleOpenSettings}
            activeDownloads={activeDownloads}
          />
        }
      />
      <Route path="/settings" element={<SettingsPage onBack={handleSettingsBack} />} />
      <Route
        path="/dload"
        element={
          <DLoadPage
            onSettings={handleOpenSettings}
            activeDownloads={activeDownloads}
            pageState={dloadPageState}
            tracks={dloadTracks}
            logs={dloadLogs}
            statusNote={dloadStatusNote}
            onStart={handleDLoadStart}
            onStop={handleDLoadStop}
            onReset={handleDLoadReset}
            onAuthorize={handleDLoadAuthorize}
            onAuthResult={handleDLoadAuthResult}
            onClearLogs={() => setDloadLogs([])}
          />
        }
      />
      <Route
        path="*"
        element={
          <URLInputPage
            onFetch={handleFetch}
            onSettings={handleOpenSettings}
            loading={fetchLoading}
            error={fetchError}
            activeDownloads={activeDownloads}
          />
        }
      />
    </Routes>
  );
}
