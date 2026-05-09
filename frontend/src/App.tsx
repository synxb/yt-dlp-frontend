import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import type { DownloadStatus, PlaylistInfo, ProgressEvent, TrackInfo } from './types';
import { cancelDownload, createProgressStream, fetchPlaylist, getConfig, startDownload } from './api';
import { URLInputPage } from './pages/URLInputPage';
import { PlaylistPreviewPage } from './pages/PlaylistPreviewPage';
import { DownloadProgressPage } from './pages/DownloadProgressPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const navigate = useNavigate();

  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [downloadDir, setDownloadDir] = useState('');

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('pending');
  const [completedCount, setCompletedCount] = useState(0);
  const [progressTracks, setProgressTracks] = useState<TrackInfo[]>([]);
  const [resolvedDownloadDir, setResolvedDownloadDir] = useState('');
  const [startingDownload, setStartingDownload] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => setDownloadDir(c.downloadDir))
      .catch(() => setDownloadDir(''));
  }, []);

  const handleFetch = useCallback(async (url: string) => {
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
  }, [navigate]);

  const handleProgressEvent = useCallback(
    (event: ProgressEvent, baseTracksSnapshot?: TrackInfo[]) => {
      if (event.type === 'heartbeat') return;

      if (event.type === 'status' && event.status) {
        setDownloadStatus(event.status);
        if (event.downloadDir) setResolvedDownloadDir(event.downloadDir);
        if (event.status === 'done' || event.status === 'cancelled' || event.status === 'error') {
          esRef.current?.close();
        }
      }

      if (event.type === 'track_start' && event.trackIndex != null) {
        setProgressTracks((prev) => {
          const base = prev.length > 0 ? prev : (baseTracksSnapshot ?? prev);
          const next = [...base];
          if (next[event.trackIndex!]) {
            next[event.trackIndex!] = { ...next[event.trackIndex!], status: 'downloading' };
          }
          return next;
        });
      }

      if (event.type === 'track_progress' && event.trackIndex != null) {
        setProgressTracks((prev) => {
          const next = [...prev];
          if (next[event.trackIndex!]) {
            next[event.trackIndex!] = {
              ...next[event.trackIndex!],
              progress: event.progress ?? prev[event.trackIndex!].progress,
            };
          }
          return next;
        });
      }

      if (event.type === 'track_done' && event.trackIndex != null) {
        setProgressTracks((prev) => {
          const next = [...prev];
          if (next[event.trackIndex!]) {
            next[event.trackIndex!] = { ...next[event.trackIndex!], status: 'done', progress: 100 };
          }
          return next;
        });
        if (event.completed != null) setCompletedCount(event.completed);
      }

      if (event.type === 'track_error' && event.trackIndex != null) {
        setProgressTracks((prev) => {
          const next = [...prev];
          if (next[event.trackIndex!]) {
            next[event.trackIndex!] = {
              ...next[event.trackIndex!],
              status: 'error',
              error: event.error ?? 'Unknown error',
            };
          }
          return next;
        });
      }
    },
    [],
  );

  const handleDownload = useCallback(
    async (dir: string) => {
      if (!playlist) return;
      setStartingDownload(true);
      try {
        const res = await startDownload(playlist.url, dir);
        const initialTracks: TrackInfo[] = res.playlist.tracks.map((t) => ({
          ...t,
          status: 'queued' as const,
          progress: 0,
          error: null,
        }));
        setSessionId(res.sessionId);
        setProgressTracks(initialTracks);
        setCompletedCount(0);
        setDownloadStatus('pending');
        setResolvedDownloadDir(res.downloadDir);
        navigate('/progress');

        esRef.current?.close();
        const snap = [...initialTracks];
        esRef.current = createProgressStream(res.sessionId, (event: ProgressEvent) => {
          handleProgressEvent(event, snap);
        });
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to start download');
      } finally {
        setStartingDownload(false);
      }
    },
    [playlist, handleProgressEvent, navigate],
  );

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    await cancelDownload(sessionId);
    esRef.current?.close();
  }, [sessionId]);

  const handleOpenFolder = useCallback(() => {
    if (resolvedDownloadDir) {
      window.open(`file:///${resolvedDownloadDir.replace(/\\/g, '/')}`, '_blank');
    }
  }, [resolvedDownloadDir]);

  const handleNewDownload = useCallback(() => {
    esRef.current?.close();
    setSessionId(null);
    setPlaylist(null);
    setProgressTracks([]);
    setCompletedCount(0);
    setDownloadStatus('pending');
    setFetchError(null);
    navigate('/');
  }, [navigate]);

  const handleOpenSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleSettingsBack = useCallback(() => {
    // Reload downloadDir from config so PlaylistPreview picks up any changes
    getConfig().then((c) => setDownloadDir(c.downloadDir)).catch(() => {});
    navigate(-1);
  }, [navigate]);

  useEffect(() => () => esRef.current?.close(), []);

  // Auto-navigate back to URL input when download finishes with no errors
  useEffect(() => {
    if (downloadStatus !== 'done') return;
    const hasErrors = progressTracks.some((t) => t.status === 'error');
    if (hasErrors) return;
    const timer = setTimeout(() => {
      setSessionId(null);
      setPlaylist(null);
      setProgressTracks([]);
      setCompletedCount(0);
      setDownloadStatus('pending');
      setFetchError(null);
      navigate('/');
    }, 1500);
    return () => clearTimeout(timer);
  }, [downloadStatus, progressTracks, navigate]);

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
              onBack={handleNewDownload}
              onSettings={handleOpenSettings}
              onDownload={handleDownload}
              loading={startingDownload}
            />
          ) : (
            <URLInputPage
              onFetch={handleFetch}
              onSettings={handleOpenSettings}
              loading={fetchLoading}
              error={fetchError}
            />
          )
        }
      />
      <Route
        path="/progress"
        element={
          playlist ? (
            <DownloadProgressPage
              playlist={playlist}
              tracks={progressTracks}
              completed={completedCount}
              downloadStatus={downloadStatus}
              downloadDir={resolvedDownloadDir}
              onCancel={handleCancel}
              onOpenFolder={handleOpenFolder}
              onNewDownload={handleNewDownload}
              onSettings={handleOpenSettings}
            />
          ) : (
            <URLInputPage
              onFetch={handleFetch}
              onSettings={handleOpenSettings}
              loading={fetchLoading}
              error={fetchError}
            />
          )
        }
      />
      <Route
        path="/settings"
        element={<SettingsPage onBack={handleSettingsBack} />}
      />
      {/* Catch-all */}
      <Route
        path="*"
        element={
          <URLInputPage
            onFetch={handleFetch}
            onSettings={handleOpenSettings}
            loading={fetchLoading}
            error={fetchError}
          />
        }
      />
    </Routes>
  );
}



