import { useState } from 'react';
import { ChevronDown, ChevronUp, FolderOpen, ListMusic, XCircle } from 'lucide-react';
import type { QueueItem } from '../types';
import { ProgressTrackRow } from '../components/ProgressTrackRow';
import { AppHeader } from '../components/AppHeader';

interface QueuePageProps {
  queue: QueueItem[];
  onCancel: (sessionId: string) => void;
  onClearCompleted: () => void;
  onOpenFolder: (dir: string) => void;
  onSettings: () => void;
  activeDownloads?: number;
}

export function QueuePage({
  queue,
  onCancel,
  onClearCompleted,
  onOpenFolder,
  onSettings,
  activeDownloads = 0,
}: QueuePageProps) {
  // Tracks items the user has manually toggled away from their default state.
  // Active items default to expanded; finished items default to collapsed.
  const [toggled, setToggled] = useState<Set<string>>(new Set());

  function handleToggle(sessionId: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function isExpanded(item: QueueItem): boolean {
    const isActive = item.downloadStatus === 'running' || item.downloadStatus === 'pending';
    const manuallyToggled = toggled.has(item.sessionId);
    // Active → expanded by default; finished → collapsed by default.
    // A manual toggle flips the default.
    return isActive ? !manuallyToggled : manuallyToggled;
  }

  const completedCount = queue.filter(
    (item) =>
      item.downloadStatus === 'done' ||
      item.downloadStatus === 'cancelled' ||
      item.downloadStatus === 'error',
  ).length;

  if (queue.length === 0) {
    return (
      <div className="page page--center">
        <AppHeader onSettings={onSettings} activeDownloads={activeDownloads} />
        <main className="hero">
          <ListMusic size={48} color="#333" />
          <h2 className="hero-title" style={{ fontSize: '32px' }}>
            Queue is empty
          </h2>
          <p className="hero-subtitle">
            Search for a playlist and click "Add to Queue" to start downloading.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="page page--queue">
      <AppHeader onSettings={onSettings} activeDownloads={activeDownloads} />

      <div className="queue-toolbar">
        <span className="queue-heading">Download Queue</span>
        <span style={{ flex: 1 }} />
        {activeDownloads > 0 && (
          <span className="queue-active-badge">{activeDownloads} downloading</span>
        )}
        {completedCount > 0 && (
          <button className="queue-clear-btn" onClick={onClearCompleted}>
            Clear completed
          </button>
        )}
      </div>

      <div className="queue-list">
        {queue.map((item) => {
          const pct =
            item.tracks.length > 0
              ? Math.round((item.completed / item.tracks.length) * 100)
              : 0;
          const isDone = item.downloadStatus === 'done';
          const isCancelled = item.downloadStatus === 'cancelled';
          const isRunning = item.downloadStatus === 'running';
          const expanded = isExpanded(item);

          const statusColor = isDone
            ? '#4CAF50'
            : isCancelled
              ? '#FF6B6B'
              : isRunning
                ? '#FF4444'
                : '#9E9E9E';
          const statusLabel = isDone
            ? 'Done'
            : isCancelled
              ? 'Cancelled'
              : isRunning
                ? 'Downloading'
                : 'Pending';

          return (
            <div key={item.sessionId} className="queue-item">
              <div className="queue-item-top">
                {item.playlist.thumbnail ? (
                  <img
                    className="queue-thumb"
                    src={item.playlist.thumbnail}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="queue-thumb queue-thumb--placeholder" />
                )}

                <div className="queue-item-info">
                  <div className="queue-item-title">{item.playlist.title}</div>
                  {item.playlist.channel && (
                    <div className="queue-item-channel">{item.playlist.channel}</div>
                  )}
                  <div className="queue-progress-row">
                    <div className="queue-bar-bg">
                      <div
                        className="queue-bar-fill"
                        style={{ width: `${pct}%`, backgroundColor: statusColor }}
                      />
                    </div>
                    <span className="queue-pct" style={{ color: statusColor }}>
                      {item.completed}/{item.tracks.length}
                    </span>
                  </div>
                </div>

                <div className="queue-item-actions">
                  <span className="queue-status-badge" style={{ color: statusColor }}>
                    <span
                      className="status-dot"
                      style={{ backgroundColor: statusColor }}
                    />
                    {statusLabel}
                  </span>
                  {isDone && (
                    <button
                      className="queue-action-btn"
                      onClick={() => onOpenFolder(item.downloadDir)}
                      title="Open folder"
                    >
                      <FolderOpen size={14} />
                    </button>
                  )}
                  {!isDone && !isCancelled && (
                    <button
                      className="queue-action-btn queue-cancel-btn"
                      onClick={() => onCancel(item.sessionId)}
                      title="Cancel download"
                    >
                      <XCircle size={14} />
                    </button>
                  )}
                  <button
                    className="queue-action-btn"
                    onClick={() => handleToggle(item.sessionId)}
                    title={expanded ? 'Collapse tracks' : 'Expand tracks'}
                  >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="queue-track-list">
                  {item.tracks.map((track) => (
                    <ProgressTrackRow key={track.id} track={track} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
