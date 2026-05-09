import { XCircle, FolderOpen } from 'lucide-react';
import type { PlaylistInfo, TrackInfo, DownloadStatus } from '../types';
import { ProgressTrackRow } from '../components/ProgressTrackRow';
import { AppHeader } from '../components/AppHeader';

interface DownloadProgressPageProps {
  playlist: PlaylistInfo;
  tracks: TrackInfo[];
  completed: number;
  downloadStatus: DownloadStatus;
  downloadDir: string;
  onCancel: () => void;
  onOpenFolder: () => void;
  onNewDownload: () => void;
  onSettings: () => void;
}

export function DownloadProgressPage({
  playlist,
  tracks,
  completed,
  downloadStatus,
  downloadDir,
  onCancel,
  onOpenFolder,
  onNewDownload,
  onSettings,
}: DownloadProgressPageProps) {
  const total = tracks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = downloadStatus === 'done';
  const isCancelled = downloadStatus === 'cancelled';

  const statusLabel = isDone
    ? 'Complete'
    : isCancelled
      ? 'Cancelled'
      : 'Downloading...';

  const statusColor = isDone ? '#4CAF50' : isCancelled ? '#FF6B6B' : '#4CAF50';
  const statusBg = isDone ? '#1C2A1C' : isCancelled ? '#2A1414' : '#1C2A1C';

  return (
    <div className="page page--progress">
      <AppHeader onSettings={onSettings}>
        <div
          className="status-badge"
          style={{ backgroundColor: statusBg, color: statusColor }}
        >
          <span className="status-dot" style={{ backgroundColor: statusColor }} />
          {statusLabel}
        </div>
      </AppHeader>

      <div className="progress-main">
        {/* Overall progress card */}
        <div className="overall-card">
          <div className="overall-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                stroke="#FF4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="overall-title">{playlist.title}</span>
            <span style={{ flex: 1 }} />
            <span className="overall-count">
              {completed} / {total}
            </span>
            <span className="overall-pct">{pct}%</span>
          </div>
          <div className="overall-bar-bg">
            <div
              className="overall-bar-fill"
              style={{
                width: `${pct}%`,
                backgroundColor: isDone ? '#4CAF50' : isCancelled ? '#FF6B6B' : '#FF4444',
              }}
            />
          </div>
          {downloadDir && (
            <div className="overall-dir">
              <FolderOpen size={13} color="#5A5A5A" />
              <span>{downloadDir}</span>
            </div>
          )}
        </div>

        {/* Per-track progress list */}
        <div className="track-progress-list">
          {tracks.map((track) => (
            <ProgressTrackRow key={track.id} track={track} />
          ))}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="cancel-bar">
        <span style={{ flex: 1 }} />
        {(isDone || isCancelled) && (
          <button className="new-download-btn" onClick={onNewDownload}>
            New Download
          </button>
        )}
        {isDone && (
          <button className="open-folder-btn" onClick={onOpenFolder}>
            <FolderOpen size={15} />
            Open Folder
          </button>
        )}
        {!isDone && !isCancelled && (
          <button className="cancel-btn" onClick={onCancel}>
            <XCircle size={15} />
            Cancel Download
          </button>
        )}
      </div>
    </div>
  );
}
