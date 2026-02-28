import { useState } from 'react';
import { X, Send, Zap, GitMerge, Clock, RefreshCw, Link, AlertTriangle } from 'lucide-react';
import type { Project, Ticket, TicketPriority } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types';

const PRIORITIES: TicketPriority[] = ['P0', 'P1', 'P2', 'P3'];

interface CreateTicketModalProps {
  project: Project;
  existingTickets?: Ticket[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTicketModal({ project, existingTickets = [], onClose, onCreated }: CreateTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('P2');
  const [blockedByTickets, setBlockedByTickets] = useState<string[]>([]);
  const [yolo, setYolo] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [queued, setQueued] = useState(false);
  const [useRalph, setUseRalph] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Available tickets to block on (only non-completed tickets in same project)
  const blockableTickets = existingTickets.filter(t =>
    t.projectId === project.id &&
    !['done', 'merged'].includes(t.status)
  );

  function toggleBlockedBy(ticketId: string) {
    setBlockedByTickets(prev =>
      prev.includes(ticketId)
        ? prev.filter(id => id !== ticketId)
        : [...prev, ticketId]
    );
  }

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
          priority,
          blockedByTickets: blockedByTickets.length > 0 ? blockedByTickets : undefined,
          yolo,
          autoMerge,
          queued,
          useRalph,
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
        className="relative bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col animate-in max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700 sticky top-0 bg-surface-800 z-10">
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
              rows={6}
              className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors font-mono leading-relaxed resize-y"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              The agent will work in an isolated git worktree, then create a PR when done.
            </p>
          </div>

          {/* Priority selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Priority
            </label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => {
                const colors = PRIORITY_COLORS[p];
                const isActive = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-xs font-medium ${
                      isActive
                        ? `${colors.bg} ${colors.text} ${colors.border}`
                        : 'bg-surface-900 border-surface-600 text-slate-400 hover:border-surface-500'
                    }`}
                  >
                    {p === 'P0' && <AlertTriangle className="w-3 h-3" />}
                    {p} — {PRIORITY_LABELS[p]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dependency selector */}
          {blockableTickets.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                <Link className="w-3 h-3 inline mr-1" />
                Blocked By (dependencies)
              </label>
              <div className="space-y-1 max-h-32 overflow-y-auto bg-surface-900 rounded-lg border border-surface-600 p-2">
                {blockableTickets.map(t => {
                  const isSelected = blockedByTickets.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleBlockedBy(t.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                        isSelected
                          ? 'bg-accent-cyan/10 border border-accent-cyan/30'
                          : 'hover:bg-surface-800 border border-transparent'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border-2 shrink-0 flex items-center justify-center ${
                        isSelected ? 'border-accent-cyan bg-accent-cyan' : 'border-slate-500'
                      }`}>
                        {isSelected && <span className="text-[8px] text-black font-bold">✓</span>}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">#{t.id}</span>
                      <span className="text-xs text-slate-300 truncate">{t.subject}</span>
                      {t.priority && (
                        <span className={`text-[10px] font-medium shrink-0 ${PRIORITY_COLORS[t.priority].text}`}>
                          {t.priority}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {blockedByTickets.length > 0 && (
                <p className="text-[10px] text-accent-cyan mt-1">
                  This ticket will wait until {blockedByTickets.map(id => `#${id}`).join(', ')} complete
                </p>
              )}
            </div>
          )}

          {/* Options grid */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Options
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setYolo(!yolo)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  yolo
                    ? 'bg-accent-amber/10 border-accent-amber/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Skip all permission prompts. Agent runs fully autonomous."
              >
                <Zap className={`w-4 h-4 shrink-0 ${yolo ? 'fill-accent-amber text-accent-amber' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${yolo ? 'text-accent-amber' : 'text-slate-300'}`}>YOLO</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  yolo ? 'bg-accent-amber justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAutoMerge(!autoMerge)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  autoMerge
                    ? 'bg-accent-purple/10 border-accent-purple/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Automatically merge PR when approved and checks pass."
              >
                <GitMerge className={`w-4 h-4 shrink-0 ${autoMerge ? 'text-accent-purple' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${autoMerge ? 'text-accent-purple' : 'text-slate-300'}`}>Auto-Merge</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  autoMerge ? 'bg-accent-purple justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setQueued(!queued)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  queued
                    ? 'bg-accent-cyan/10 border-accent-cyan/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Don't start until all other non-queued tickets finish."
              >
                <Clock className={`w-4 h-4 shrink-0 ${queued ? 'text-accent-cyan' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${queued ? 'text-accent-cyan' : 'text-slate-300'}`}>Queue</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  queued ? 'bg-accent-cyan justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setUseRalph(!useRalph)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  useRalph
                    ? 'bg-accent-green/10 border-accent-green/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Iterative self-improving loop until criteria met."
              >
                <RefreshCw className={`w-4 h-4 shrink-0 ${useRalph ? 'text-accent-green' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${useRalph ? 'text-accent-green' : 'text-slate-300'}`}>Ralph Loop</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  useRalph ? 'bg-accent-green justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>
            </div>
          </div>

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
