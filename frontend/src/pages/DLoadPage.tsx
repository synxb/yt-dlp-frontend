import { useEffect, useRef } from 'react';
import { Download, Square } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { ProgressTrackRow } from '../components/ProgressTrackRow';
import type { DLoadLogLine, DLoadPageState, TrackInfo } from '../types';

interface DLoadPageProps {
  onSettings: () => void;
  activeDownloads?: number;
  pageState: DLoadPageState;
  tracks: TrackInfo[];
  logs: DLoadLogLine[];
  statusNote: string;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onAuthorize: () => void;
  onAuthResult: (result: 'success' | 'error', detail?: string) => void;
  onClearLogs: () => void;
}

export function DLoadPage({
  onSettings,
  activeDownloads = 0,
  pageState,
  tracks,
  logs,
  statusNote,
  onStart,
  onStop,
  onReset,
  onAuthorize,
  onAuthResult,
  onClearLogs,
}: DLoadPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const debugRef = useRef<HTMLDivElement>(null);

  // Handle OAuth redirect result (?auth=success or ?auth=error)
  useEffect(() => {
    const authResult = searchParams.get('auth');
    if (authResult === 'success' || authResult === 'error') {
      const detail = searchParams.get('detail') ?? undefined;
      onAuthResult(authResult, detail);

      // If OAuth completed inside a popup, notify the opener and self-close.
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(
          { type: 'dload-oauth-result', result: authResult, detail },
          window.location.origin,
        );
        window.close();
        return;
      }

      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll debug box on new log entries
  useEffect(() => {
    if (debugRef.current) {
      debugRef.current.scrollTop = debugRef.current.scrollHeight;
    }
  }, [logs]);

  function levelColor(level: DLoadLogLine['level']): string {
    switch (level) {
      case 'warning': return '#F5A623';
      case 'error':   return '#FF5555';
      case 'success': return '#50FA7B';
      default:        return '#888888';
    }
  }

  const isError = statusNote.toLowerCase().includes('fail') || statusNote.toLowerCase().includes('error');

  return (
    <div className="page">
      <AppHeader onSettings={onSettings} activeDownloads={activeDownloads} />

      <main className="dload-page">
        {/* ── Top controls ── */}
        <div className="dload-center">
          <h1 className="dload-title">Music DLoad</h1>
          <p className="dload-subtitle">
            Downloads your "Music To Download" playlist, validates each file,
            then wipes successfully downloaded tracks.
          </p>

          {statusNote && (
            <p className="dload-status-note" style={{ color: isError ? '#FF5555' : '#50FA7B' }}>
              {statusNote}
            </p>
          )}

          {pageState === 'checking' && <p className="dload-hint">Checking authorization…</p>}

          {pageState === 'no_secrets' && (
            <div className="dload-warning-box">
              <p><strong>client_secrets.json</strong> not found in the backend directory.</p>
              <p style={{ marginTop: 8, fontSize: 13, color: '#9E9E9E' }}>
                Download an OAuth 2.0 client secret from Google Cloud Console and place it at{' '}
                <code>backend/client_secrets.json</code>.
              </p>
            </div>
          )}

          {pageState === 'needs_auth' && (
            <button className="dload-btn dload-btn--auth" onClick={onAuthorize}>
              Authorize with Google
            </button>
          )}

          {pageState === 'ready' && (
            <button className="dload-btn dload-btn--start" onClick={onStart}>
              <Download size={20} />
              Music DLoad
            </button>
          )}

          {pageState === 'running' && (
            <div className="dload-btn-row">
              <button className="dload-btn dload-btn--start" disabled>
                <span className="loading-dots">Running</span>
              </button>
              <button className="dload-btn dload-btn--stop" onClick={onStop}>
                <Square size={16} />
                Stop
              </button>
            </div>
          )}

          {(pageState === 'done' || pageState === 'cancelled') && (
            <button className="dload-btn dload-btn--start" onClick={onReset}>
              {pageState === 'cancelled' ? 'Cancelled — Run Again' : 'Run Again'}
            </button>
          )}
        </div>

        {/* ── Track list — always visible ── */}
        <div className="dload-track-list">
          {tracks.length === 0 ? (
            <div className="dload-track-empty">
              {pageState === 'running'
                ? 'Fetching playlist…'
                : pageState === 'done' || pageState === 'cancelled'
                  ? 'No tracks were recorded.'
                  : 'Tracks will appear here once a download starts.'}
            </div>
          ) : (
            tracks.map((t) => <ProgressTrackRow key={t.index} track={t} />)
          )}
        </div>

        {/* ── Debug log ── */}
        <div className="dload-debug">
          <div className="dload-debug-header">
            <span>Log</span>
            {logs.length > 0 && (
              <button className="dload-debug-clear" onClick={onClearLogs}>Clear</button>
            )}
          </div>
          <div className="dload-debug-body" ref={debugRef}>
            {logs.length === 0 ? (
              <span className="dload-debug-empty">No output yet.</span>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="dload-debug-line" style={{ color: levelColor(entry.level) }}>
                  <span className="dload-debug-level">[{entry.level.toUpperCase()}]</span>{' '}
                  {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
