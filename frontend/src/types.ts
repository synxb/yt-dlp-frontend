export type TrackStatus = 'queued' | 'downloading' | 'done' | 'error' | 'skipped';

export interface TrackInfo {
  index: number;
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  status: TrackStatus;
  progress: number;
  error: string | null;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  url: string;
  channel: string | null;
  thumbnail: string | null;
  tracks: TrackInfo[];
}

export type DownloadStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'error';

export interface QueueItem {
  sessionId: string;
  playlist: PlaylistInfo;
  tracks: TrackInfo[];
  downloadStatus: DownloadStatus;
  completed: number;
  downloadDir: string;
  addedAt: number;
}

export interface ProgressEvent {
  type:
    | 'status'
    | 'track_start'
    | 'track_progress'
    | 'track_done'
    | 'track_error'
    | 'heartbeat';
  status?: DownloadStatus;
  trackIndex?: number;
  trackTitle?: string;
  progress?: number;
  completed?: number;
  total?: number;
  error?: string;
  downloadDir?: string;
}

export type DLoadPageState =
  | 'checking'
  | 'no_secrets'
  | 'needs_auth'
  | 'ready'
  | 'running'
  | 'done'
  | 'cancelled';

export interface DLoadLogLine {
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}
