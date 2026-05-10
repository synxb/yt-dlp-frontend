import { useEffect, useState } from 'react';
import { Music, Search } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import type { HistoryEntry } from '../api';
import { getDownloadHistory } from '../api';

interface URLInputPageProps {
  onFetch: (url: string) => void;
  onSettings: () => void;
  loading: boolean;
  error: string | null;
  activeDownloads?: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function URLInputPage({ onFetch, onSettings, loading, error, activeDownloads = 0 }: URLInputPageProps) {
  const [url, setUrl] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    getDownloadHistory().then(setHistory).catch(() => {});
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onFetch(trimmed);
  }

  return (
    <div className="page page--center">
      <AppHeader onSettings={onSettings} activeDownloads={activeDownloads} />

      <main className="hero">
        <h1 className="hero-title">Download YouTube Playlists</h1>
        <p className="hero-subtitle">
          Paste a YouTube playlist URL to fetch its contents and download it as MP3
        </p>

        <form className="input-card" onSubmit={handleSubmit}>
          <input
            className="url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube playlist URL (e.g. https://youtube.com/playlist?list=...)"
            disabled={loading}
            autoFocus
          />
          <button className="fetch-btn" type="submit" disabled={loading || !url.trim()}>
            {loading ? (
              <span className="loading-dots">Fetching</span>
            ) : (
              <>
                <Search size={16} />
                Fetch Playlist
              </>
            )}
          </button>
        </form>

        {error && <p className="error-message">{error}</p>}

        <p className="hint-text">
          Supports public playlists&nbsp;&bull;&nbsp;Downloads as MP3 at 320kbps&nbsp;&bull;&nbsp;Embeds
          metadata &amp; artwork
        </p>

        {history.length > 0 && (
          <section className="history-section">
            <h2 className="history-heading">Previously downloaded</h2>
            <ul className="history-list">
              {history.map((entry) => (
                <li key={entry.id} className="history-item">
                  <button
                    className="history-item-btn"
                    onClick={() => onFetch(entry.url)}
                    disabled={loading}
                    title={`Re-fetch "${entry.title}"`}
                  >
                    {entry.thumbnail ? (
                      <img
                        className="history-thumb"
                        src={entry.thumbnail}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="history-thumb history-thumb--placeholder">
                        <Music size={18} color="#444" />
                      </div>
                    )}
                    <div className="history-info">
                      <span className="history-title">{entry.title}</span>
                      <span className="history-meta">
                        {entry.channel && <span>{entry.channel}&nbsp;&bull;&nbsp;</span>}
                        {entry.track_count} track{entry.track_count !== 1 ? 's' : ''}
                        &nbsp;&bull;&nbsp;{formatDate(entry.completed_at)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
