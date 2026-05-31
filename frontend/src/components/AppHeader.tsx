import { Settings } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface AppHeaderProps {
  onSettings: () => void;
  children?: React.ReactNode;
  activeDownloads?: number;
}

export function AppHeader({ onSettings, children, activeDownloads = 0 }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const onSearch = location.pathname === '/' || location.pathname === '/preview';
  const onQueue = location.pathname === '/queue';
  const onDLoad = location.pathname === '/dload';

  return (
    <header className="header">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"
          fill="#FF4444"
        />
        <polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="white" />
      </svg>
      <span className="header-title">YT Downloader</span>
      <nav className="header-nav">
        <button
          className={`header-nav-btn${onSearch ? ' header-nav-btn--active' : ''}`}
          onClick={() => navigate('/')}
        >
          Search
        </button>
        <button
          className={`header-nav-btn${onQueue ? ' header-nav-btn--active' : ''}`}
          onClick={() => navigate('/queue')}
        >
          Queue
          {activeDownloads > 0 && (
            <span className="header-nav-badge">{activeDownloads}</span>
          )}
        </button>
        <button
          className={`header-nav-btn${onDLoad ? ' header-nav-btn--active' : ''}`}
          onClick={() => navigate('/dload')}
        >
          DLoad
        </button>
      </nav>
      {children}
      <span style={{ flex: 1 }} />
      <button className="header-settings-btn" onClick={onSettings} title="Settings">
        <Settings size={18} />
      </button>
    </header>
  );
}
