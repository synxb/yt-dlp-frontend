import type { TrackInfo } from '../types';

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TrackRowProps {
  track: TrackInfo;
  index: number;
}

export function TrackRow({ track, index }: TrackRowProps) {
  return (
    <div className="track-row">
      <span className="track-num">{String(index + 1).padStart(2, '0')}</span>
      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" className="track-thumb" />
      ) : (
        <div className="track-thumb track-thumb--placeholder" />
      )}
      <div className="track-info">
        <span className="track-title">{track.title}</span>
      </div>
      <span className="track-duration">{formatDuration(track.duration)}</span>
    </div>
  );
}
