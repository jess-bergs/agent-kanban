import { useState } from 'react';
import { X, Send, Zap, GitMerge } from 'lucide-react';
import type { Project } from '../types';

interface CreateTicketModalProps {
  project: Project;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTicketModal({ project, onClose, onCreated }: CreateTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [instructions, setInstructions] = useState('');
  const [yolo, setYolo] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !instructions.trim()) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          subject: subject.trim(),
          instructions: instructions.trim(),
          yolo,
          autoMerge,
        }),
      });
      if (res.ok) {
        onCreated();
        onClose();
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col animate-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-bold text-slate-100">New Ticket</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {project.name} &middot; {project.repoPath}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Add dark mode toggle"
              className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Instructions
            </label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="Full prompt for the agent. Be specific about what you want built, changed, or fixed..."
              rows={10}
              className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors font-mono leading-relaxed resize-y"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              The agent will work in an isolated git worktree, then create a PR when done.
            </p>
          </div>

          {/* Yolo mode toggle */}
          <button
            type="button"
            onClick={() => setYolo(!yolo)}
            className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${
              yolo
                ? 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber'
                : 'bg-surface-900 border-surface-600 text-slate-400 hover:text-slate-200 hover:border-surface-500'
            }`}
          >
            <Zap className={`w-5 h-5 shrink-0 ${yolo ? 'fill-accent-amber' : ''}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${yolo ? 'text-accent-amber' : 'text-slate-200'}`}>
                YOLO Mode
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Skip all permission prompts. Agent runs fully autonomous — no file write, bash, or tool confirmations.
              </p>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors flex items-center shrink-0 ${
              yolo ? 'bg-accent-amber justify-end' : 'bg-surface-600 justify-start'
            }`}>
              <div className="w-4 h-4 bg-white rounded-full mx-1 shadow-sm" />
            </div>
          </button>

          {/* Auto-merge toggle */}
          <button
            type="button"
            onClick={() => setAutoMerge(!autoMerge)}
            className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${
              autoMerge
                ? 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple'
                : 'bg-surface-900 border-surface-600 text-slate-400 hover:text-slate-200 hover:border-surface-500'
            }`}
          >
            <GitMerge className={`w-5 h-5 shrink-0 ${autoMerge ? 'text-accent-purple' : ''}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${autoMerge ? 'text-accent-purple' : 'text-slate-200'}`}>
                Auto-Merge
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Automatically merge the PR when it has at least one approval and all checks pass.
              </p>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors flex items-center shrink-0 ${
              autoMerge ? 'bg-accent-purple justify-end' : 'bg-surface-600 justify-start'
            }`}>
              <div className="w-4 h-4 bg-white rounded-full mx-1 shadow-sm" />
            </div>
          </button>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!subject.trim() || !instructions.trim() || submitting}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                yolo
                  ? 'bg-accent-amber text-black hover:bg-accent-amber/90'
                  : 'bg-accent-blue text-white hover:bg-accent-blue/90'
              }`}
            >
              {yolo ? <Zap className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {submitting ? 'Creating...' : yolo ? 'YOLO & Dispatch' : 'Create & Dispatch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
