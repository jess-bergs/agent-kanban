import { useState } from 'react';
import { X, FolderPlus, FolderOpen } from 'lucide-react';
import { FolderPicker } from './FolderPicker';

interface AddProjectModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function AddProjectModal({ onClose, onCreated }: AddProjectModalProps) {
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repoPath.trim()) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath: repoPath.trim(),
          name: name.trim() || undefined,
        }),
      });
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add project');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-full max-w-lg flex flex-col animate-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <h2 className="text-lg font-bold text-slate-100">Add Project</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Repository Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={repoPath}
                onChange={e => { setRepoPath(e.target.value); setShowPicker(false); }}
                placeholder="/Users/you/development/my-project"
                className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors font-mono"
                autoFocus={!showPicker}
              />
              <button
                type="button"
                onClick={() => setShowPicker(!showPicker)}
                className={`px-3 py-2 rounded-lg border transition-colors ${
                  showPicker
                    ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                    : 'bg-surface-900 border-surface-600 text-slate-400 hover:text-slate-200 hover:border-surface-500'
                }`}
                title="Browse folders"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Absolute path to a git repository, or use the folder picker.
            </p>
          </div>

          {showPicker && (
            <FolderPicker
              onSelect={(path) => {
                setRepoPath(path);
                setShowPicker(false);
              }}
              onCancel={() => setShowPicker(false)}
            />
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Display Name <span className="text-slate-500">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Auto-detected from folder name"
              className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-accent-red bg-accent-red/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!repoPath.trim() || submitting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              {submitting ? 'Adding...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
