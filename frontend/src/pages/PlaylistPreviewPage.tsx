import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  FolderOpen,
  Loader2,
  Music,
  User,
} from 'lucide-react';
import type { PlaylistInfo } from '../types';
import { TrackRow, formatDuration } from '../components/TrackRow';
import { AppHeader } from '../components/AppHeader';
import { FolderPickerModal } from '../components/FolderPickerModal';

interface PlaylistPreviewPageProps {
  playlist: PlaylistInfo;
  defaultDownloadDir: string;
  onBack: () => void;
  onSettings: () => void;
  onAddToQueue: (downloadDir: string, selectedIds: Set<string>) => void;
  activeDownloads?: number;
  loading: boolean;
}

export function PlaylistPreviewPage({
  playlist,
  defaultDownloadDir,
  onBack,
  onSettings,
  onAddToQueue,
  activeDownloads = 0,
  loading,
}: PlaylistPreviewPageProps) {
  const [downloadDir, setDownloadDir] = useState(defaultDownloadDir);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(playlist.tracks.map((t) => t.id)),
  );

  const allSelected = selectedIds.size === playlist.tracks.length;

  function toggleTrack(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(playlist.tracks.map((t) => t.id)));
    }
  }

  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0);

  return (
    <div className="page page--split">
      {loading && (
        <div className="fullscreen-loading-overlay">
          <Loader2 size={40} className="fullscreen-loading-spinner" />
          <span className="fullscreen-loading-label">Adding to queue…</span>
        </div>
      )}
      <AppHeader onSettings={onSettings} activeDownloads={activeDownloads}>
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          New Search
        </button>
      </AppHeader>

      <div className="split-content">
        {/* Left: playlist thumbnail + meta */}
        <aside className="left-panel">
          {playlist.thumbnail ? (
            <img src={playlist.thumbnail} alt={playlist.title} className="playlist-thumb" />
          ) : (
            <div className="playlist-thumb playlist-thumb--placeholder" />
          )}

          <div className="playlist-meta">
            <h2 className="playlist-title">{playlist.title}</h2>

            {playlist.channel && (
              <div className="meta-row">
                <User size={14} color="#9E9E9E" />
                <span className="meta-text">{playlist.channel}</span>
              </div>
            )}

            <div className="badges-row">
              <div className="badge">
                <Music size={12} color="#FF4444" />
                <span>{playlist.tracks.length} tracks</span>
              </div>
              {totalDuration > 0 && (
                <div className="badge">
                  <span>{formatDuration(totalDuration)}</span>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Right: track list */}
        <div className="right-panel">
          <div className="track-list-header">
            <span className="track-list-title">Playlist Contents</span>
            <span style={{ flex: 1 }} />
            <span className="track-selection-count">
              {selectedIds.size} / {playlist.tracks.length} selected
            </span>
            <button className="select-all-btn" onClick={toggleAll}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="track-list">
            {playlist.tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                selected={selectedIds.has(track.id)}
                onToggle={() => toggleTrack(track.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Bottom download bar */}
      <div className="download-bar">
        <button
          className="folder-browse-btn"
          onClick={() => setShowPicker(true)}
          title="Choose download folder"
        >
          <FolderOpen size={15} />
          <span className="folder-browse-path">{downloadDir || 'Choose folder…'}</span>
        </button>
        {showPicker && (
          <FolderPickerModal
            initialPath={downloadDir}
            onSelect={setDownloadDir}
            onClose={() => setShowPicker(false)}
          />
        )}
        <span style={{ flex: 1 }} />
        <button
          className="download-btn"
          onClick={() => onAddToQueue(downloadDir, selectedIds)}
          disabled={loading || selectedIds.size === 0}
        >
          <Download size={18} />
          {`Add to Queue (${selectedIds.size} track${selectedIds.size !== 1 ? 's' : ''})`}
        </button>
      </div>
    </div>
  );
}

// Youtube28 component removed — logo now lives in AppHeader

