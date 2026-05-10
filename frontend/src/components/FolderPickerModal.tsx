import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, X } from 'lucide-react';
import { listDir } from '../api';

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPickerModal({ initialPath, onSelect, onClose }: Props) {
  const [current, setCurrent] = useState<string>('');
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  function basename(p: string): string {
    return p.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? p;
  }

  async function navigate(path?: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await listDir(path);
      setCurrent(data.current);
      setParent(data.parent);
      setDirs(data.dirs);
      setManualPath(data.current);
    } catch {
      setError('Could not read directory.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    navigate(initialPath);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    await navigate(manualPath);
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Breadcrumb segments
  const segments = current.replace(/\\/g, '/').split('/').filter(Boolean);
  function pathUpTo(idx: number): string {
    const parts = segments.slice(0, idx + 1);
    // Reconstruct absolute path
    if (current.startsWith('/')) return '/' + parts.join('/');
    // Windows drive letter
    return parts.join('/');
  }

  return (
    <div className="fp-backdrop" onClick={handleBackdropClick}>
      <div className="fp-modal" role="dialog" aria-modal="true" aria-label="Choose folder">
        {/* Header */}
        <div className="fp-header">
          <span className="fp-title">Choose Folder</span>
          <button className="fp-close-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="fp-breadcrumb">
          {segments.map((seg, i) => (
            <span key={i} className="fp-breadcrumb-item">
              {i > 0 && <ChevronRight size={12} className="fp-chevron" />}
              <button
                className="fp-breadcrumb-btn"
                onClick={() => navigate(pathUpTo(i))}
                title={pathUpTo(i)}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* Directory list */}
        <div className="fp-list-area">
          {loading && <div className="fp-status">Loading…</div>}
          {error && <div className="fp-status fp-status--error">{error}</div>}
          {!loading && !error && (
            <ul className="fp-dir-list" ref={listRef}>
              {parent !== null && (
                <li>
                  <button className="fp-dir-item fp-dir-item--up" onClick={() => navigate(parent)}>
                    <Folder size={15} />
                    <span>..</span>
                  </button>
                </li>
              )}
              {dirs.length === 0 && (
                <li className="fp-status">No subdirectories</li>
              )}
              {dirs.map((d) => (
                <li key={d}>
                  <button className="fp-dir-item" onClick={() => navigate(d)}>
                    <Folder size={15} />
                    <span>{basename(d)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Manual path input */}
        <form className="fp-manual" onSubmit={handleManualSubmit}>
          <input
            className="fp-path-input"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="Type a path…"
            spellCheck={false}
          />
          <button type="submit" className="fp-go-btn">Go</button>
        </form>

        {/* Footer */}
        <div className="fp-footer">
          <button className="fp-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="fp-select-btn"
            onClick={() => { onSelect(current); onClose(); }}
            disabled={!current}
          >
            <FolderOpen size={15} />
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
}
