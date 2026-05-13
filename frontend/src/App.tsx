import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import type { DownloadStatus, PlaylistInfo, ProgressEvent, TrackInfo, QueueItem } from './types';
import { cancelDownload, createProgressStream, fetchPlaylist, getConfig, listSessions, removeSession, startDownload } from './api';
import { URLInputPage } from './pages/URLInputPage';
import { PlaylistPreviewPage } from './pages/PlaylistPreviewPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const navigate = useNavigate();

  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [addingToQueue, setAddingToQueue] = useState(false);
  const esRefs = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    getConfig()
      .then((c) => setDownloadDir(c.downloadDir))
      .catch(() => setDownloadDir(''));
  }, []);

  // Cleanup all SSE streams on unmount
  useEffect(() => {
    return () => {
      esRefs.current.forEach((es) => es.close());
    };
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
