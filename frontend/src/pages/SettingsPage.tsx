import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, RefreshCw, Save } from 'lucide-react';
import type { PlexLibrary, Settings } from '../api';
import { getPlexLibraries, getSettings, saveSettings, triggerPlexScan } from '../api';
import { FolderPickerModal } from '../components/FolderPickerModal';

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  // ── Load state ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // ── Download fields ──────────────────────────────────────────────────
  const [downloadDir, setDownloadDir] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // ── Plex fields ──────────────────────────────────────────────────────
  const [plexUrl, setPlexUrl] = useState('');
  const [plexToken, setPlexToken] = useState('');
  const [plexLibrarySectionId, setPlexLibrarySectionId] = useState('');

  // ── Library fetch ─────────────────────────────────────────────────────
  const [plexLibraries, setPlexLibraries] = useState<PlexLibrary[]>([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [librariesError, setLibrariesError] = useState<string | null>(null);

  // ── Save ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Plex scan ─────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setDownloadDir(s.downloadDir);
        setPlexUrl(s.plexUrl ?? '');
        setPlexToken(s.plexToken ?? '');
        setPlexLibrarySectionId(s.plexLibrarySectionId ?? '');
      })
      .catch(() => setSaveError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleLoadLibraries() {
    setLoadingLibraries(true);
    setLibrariesError(null);
    try {
      await saveSettings(buildSettings());
      const libs = await getPlexLibraries();
      setPlexLibraries(libs);
      if (libs.length > 0 && !plexLibrarySectionId) {
        const music = libs.find((l) => l.type === 'artist') ?? libs[0];
        setPlexLibrarySectionId(music.id);
      }
    } catch (err: unknown) {
      setLibrariesError(err instanceof Error ? err.message : 'Failed to load libraries');
    } finally {
      setLoadingLibraries(false);
    }
  }

  function buildSettings(): Settings {
    return {
      downloadDir,
      plexUrl: plexUrl.trim(),
      plexToken: plexToken.trim(),
      plexLibrarySectionId: plexLibrarySectionId.trim(),
    };
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await saveSettings(buildSettings());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    setScanSuccess(false);
    try {
      await saveSettings(buildSettings());
      await triggerPlexScan();
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 3000);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  const plexConfigured = plexUrl.trim() !== '' && plexToken.trim() !== '';

  return (
    <div className="page page--settings">
      <header className="header">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"
            fill="#FF4444"
          />
          <polygon points="9.75,15.02 15.5,12 9.75,8.98 9.75,15.02" fill="white" />
        </svg>
        <span className="header-title">Settings</span>
        <span style={{ flex: 1 }} />
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={14} />
          Back
        </button>
      </header>

      <div className="settings-body">
        {loading ? (
          <p className="settings-loading">Loading…</p>
        ) : (
          <>
            {/* ── Download section ──────────────────────────────────── */}
            <div className="settings-card">
              <h2 className="settings-section-title">Download</h2>

              <div className="settings-field">
                <label className="settings-label" htmlFor="downloadDir">
                  Default download folder
                </label>
                <p className="settings-description">
                  Playlists are saved into a sub-folder of this directory named after the playlist.
                </p>
                <div className="settings-dir-row">
                  <input
                    id="downloadDir"
                    className="settings-dir-input"
                    type="text"
                    value={downloadDir}
                    onChange={(e) => setDownloadDir(e.target.value)}
                    spellCheck={false}
                  />
                  <button
                    className="settings-browse-btn"
                    onClick={() => setShowPicker(true)}
                    title="Browse…"
                  >
                    <FolderOpen size={15} />
                    Browse…
                  </button>
                </div>
              </div>
            </div>

            {showPicker && (
              <FolderPickerModal
                initialPath={downloadDir}
                onSelect={setDownloadDir}
                onClose={() => setShowPicker(false)}
              />
            )}

            {/* ── Plex section ──────────────────────────────────────── */}
            <div className="settings-card">
              <h2 className="settings-section-title">Plex Media Server</h2>

              <div className="settings-field">
                <label className="settings-label" htmlFor="plexUrl">
                  Server URL
                </label>
                <p className="settings-description">
                  Base URL of your Plex server, e.g.{' '}
                  <code className="settings-code">http://192.168.1.10:32400</code>
                </p>
                <input
                  id="plexUrl"
                  className="settings-dir-input"
                  type="text"
                  value={plexUrl}
                  onChange={(e) => setPlexUrl(e.target.value)}
                  placeholder="http://192.168.1.10:32400"
                  spellCheck={false}
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="plexToken">
                  Plex token
                </label>
                <p className="settings-description">
                  Your Plex authentication token. To find it: open the Plex Web App, browse to any
                  media item, click the <code className="settings-code">⋮</code> menu →{' '}
                  <code className="settings-code">Get Info</code> → click{' '}
                  <code className="settings-code">View XML</code> at the bottom of the panel. Your
                  browser will open an XML URL — copy the value of the{' '}
                  <code className="settings-code">X-Plex-Token</code> query parameter from the
                  address bar.
                </p>
                <input
                  id="plexToken"
                  className="settings-dir-input settings-token-input"
                  type="password"
                  value={plexToken}
                  onChange={(e) => setPlexToken(e.target.value)}
                  placeholder="Enter Plex token"
                  autoComplete="off"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label" htmlFor="plexSection">
                  Music library
                </label>
                <p className="settings-description">
                  The library section to scan when you click Sync Music.
                </p>
                <div className="settings-dir-row">
                  {plexLibraries.length > 0 ? (
                    <select
                      id="plexSection"
                      className="settings-dir-input settings-select"
                      value={plexLibrarySectionId}
                      onChange={(e) => setPlexLibrarySectionId(e.target.value)}
                    >
                      <option value="">— select a library —</option>
                      {plexLibraries.map((lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.title} ({lib.type})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="plexSection"
                      className="settings-dir-input"
                      type="text"
                      value={plexLibrarySectionId}
                      onChange={(e) => setPlexLibrarySectionId(e.target.value)}
                      placeholder="Section ID — or click Load libraries to pick"
                      spellCheck={false}
                    />
                  )}
                  <button
                    className="settings-browse-btn"
                    onClick={handleLoadLibraries}
                    disabled={loadingLibraries || !plexConfigured}
                    title={plexConfigured ? 'Load libraries from Plex' : 'Enter URL and token first'}
                  >
                    <RefreshCw size={15} className={loadingLibraries ? 'spin' : ''} />
                    {loadingLibraries ? 'Loading…' : 'Load libraries'}
                  </button>
                </div>
                {librariesError && <p className="settings-error">{librariesError}</p>}
              </div>

              <div className="settings-plex-actions">
                <div className="settings-scan-feedback">
                  {scanSuccess && <span className="settings-saved">Scan triggered ✓</span>}
                  {scanError && <span className="settings-error">{scanError}</span>}
                </div>
                <button
                  className="settings-scan-btn"
                  onClick={handleScan}
                  disabled={scanning || !plexConfigured || !plexLibrarySectionId.trim()}
                  title={
                    !plexConfigured
                      ? 'Configure Plex URL and token first'
                      : !plexLibrarySectionId.trim()
                      ? 'Select a library section first'
                      : 'Trigger a Plex library scan'
                  }
                >
                  <RefreshCw size={15} className={scanning ? 'spin' : ''} />
                  {scanning ? 'Syncing…' : 'Sync Music'}
                </button>
              </div>
            </div>

            {/* ── Save row ────────────────────────────────────────────── */}
            <div className="settings-footer">
              {saveError && <p className="settings-error">{saveError}</p>}
              <div className="settings-actions">
                {saved && <span className="settings-saved">Saved</span>}
                <button
                  className="settings-save-btn"
                  onClick={handleSave}
                  disabled={saving || loading}
                >
                  <Save size={15} />
                  {saving ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
