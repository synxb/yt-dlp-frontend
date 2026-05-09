import type { TrackInfo, TrackStatus } from '../types';
import { CheckCircle, Loader, Clock, XCircle } from 'lucide-react';

function StatusIcon({ status }: { status: TrackStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle size={18} color="#4CAF50" />;
    case 'downloading':
      return <Loader size={18} color="#FF4444" className="spin" />;
    case 'error':
      return <XCircle size={18} color="#FF6B6B" />;
    default:
      return <Clock size={18} color="#5A5A5A" />;
  }
}

function statusLabel(track: TrackInfo): { text: string; color: string } {
  switch (track.status) {
    case 'done':
      return { text: 'Done', color: '#4CAF50' };
    case 'downloading':
      return { text: `${Math.round(track.progress)}%`, color: '#FF4444' };
    case 'error':
      return { text: 'Error', color: '#FF6B6B' };
    default:
      return { text: 'Queued', color: '#5A5A5A' };
  }
}

interface ProgressTrackRowProps {
  track: TrackInfo;
}

export function ProgressTrackRow({ track }: ProgressTrackRowProps) {
  const label = statusLabel(track);
  const fillWidth =
    track.status === 'done'
      ? '100%'
      : track.status === 'downloading'
        ? `${track.progress}%`
        : '0%';

  const fillColor =
    track.status === 'done'
      ? '#4CAF50'
      : track.status === 'error'
        ? '#FF6B6B'
        : '#FF4444';

  return (
    <div className="progress-track-row">
      <StatusIcon status={track.status} />
      <div className="progress-track-info">
        <span className="progress-track-title">{track.title}</span>
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: fillWidth, backgroundColor: fillColor }}
          />
        </div>
      </div>
      <span className="progress-track-pct" style={{ color: label.color }}>
        {label.text}
      </span>
    </div>
  );
}
