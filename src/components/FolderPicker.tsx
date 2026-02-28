import { useState, useEffect } from 'react';
import { Folder, FolderGit2, ChevronUp, Loader2 } from 'lucide-react';

interface DirEntry {
  name: string;
  path: string;
  isGit: boolean;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

interface FolderPickerProps {
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function FolderPicker({ onSelect, onCancel }: FolderPickerProps) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function browse(path?: string) {
    setLoading(true);
    setError('');
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError('Cannot read directory');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { browse(); }, []);

  return (
    <div className="border border-surface-600 rounded-lg overflow-hidden bg-surface-900">
      {/* Current path + up button */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-surface-700">
        {data?.parent && (
          <button
            type="button"
            onClick={() => browse(data.parent!)}
            className="p-1 rounded hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
            title="Go up"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        )}
        <span className="text-xs text-slate-400 font-mono truncate flex-1">
          {data?.current ?? '...'}
        </span>
        <button
          type="button"
          onClick={() => data && onSelect(data.current)}
          className="text-[10px] font-medium text-accent-blue hover:text-accent-blue/80 transition-colors shrink-0 px-2 py-1 rounded hover:bg-surface-700"
        >
          Select this folder
        </button>
      </div>

      {/* Directory list */}
      <div className="max-h-52 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-6 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}

        {error && (
          <p className="text-xs text-accent-red px-3 py-4 text-center">{error}</p>
        )}

        {!loading && !error && data && data.dirs.length === 0 && (
          <p className="text-xs text-slate-500 px-3 py-4 text-center">No subdirectories</p>
        )}

        {!loading && !error && data?.dirs.map(dir => (
          <button
            key={dir.path}
            type="button"
            onClick={() => dir.isGit ? onSelect(dir.path) : browse(dir.path)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-800 transition-colors group"
          >
            {dir.isGit ? (
              <FolderGit2 className="w-4 h-4 text-accent-green shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-slate-500 shrink-0" />
            )}
            <span className={`text-sm truncate ${dir.isGit ? 'text-slate-100' : 'text-slate-400'}`}>
              {dir.name}
            </span>
            {dir.isGit && (
              <span className="ml-auto text-[10px] text-accent-green/70 opacity-0 group-hover:opacity-100 transition-opacity">
                select
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="flex justify-end px-3 py-2 border-t border-surface-700">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
