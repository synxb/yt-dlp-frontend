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
  selected?: boolean;
  onToggle?: () => void;
}

export function TrackRow({ track, index, selected = true, onToggle }: TrackRowProps) {
  const classes = [
    'track-row',
    onToggle ? 'track-row--selectable' : '',
    !selected ? 'track-row--deselected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle?.();
    }
  }

  return (
    <div
      className={classes}
      onClick={onToggle}
      role={onToggle ? 'checkbox' : undefined}
      aria-checked={onToggle ? selected : undefined}
      tabIndex={onToggle ? 0 : undefined}
      onKeyDown={onToggle ? handleKeyDown : undefined}
    >
      {onToggle && (
        <span className={`track-checkbox${selected ? ' track-checkbox--checked' : ''}`} />
      )}
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
