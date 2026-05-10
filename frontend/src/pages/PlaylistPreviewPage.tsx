import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  FolderOpen,
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
  onDownload: (downloadDir: string) => void;
  loading: boolean;
}

export function PlaylistPreviewPage({
  playlist,
  defaultDownloadDir,
  onBack,
  onSettings,
  onDownload,
  loading,
}: PlaylistPreviewPageProps) {
  const [downloadDir, setDownloadDir] = useState(defaultDownloadDir);
  const [showPicker, setShowPicker] = useState(false);

  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration ?? 0), 0);

  return (
    <div className="page page--split">
      <AppHeader onSettings={onSettings}>
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
          </div>
          <div className="track-list">
            {playlist.tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i} />
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
          onClick={() => onDownload(downloadDir)}
          disabled={loading}
        >
          <Download size={18} />
          {loading
            ? 'Starting…'
            : `Download Playlist (${playlist.tracks.length} tracks)`}
        </button>
      </div>
    </div>
  );
}

// Youtube28 component removed — logo now lives in AppHeader
