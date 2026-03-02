import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Zap, GitMerge, Clock, RefreshCw, Users, ImagePlus, FileSearch } from 'lucide-react';
import type { Project } from '../types';

interface PendingImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface CreateTicketModalProps {
  project: Project;
  onClose: () => void;
  onCreated: () => void;
}

let nextImageId = 0;

export function CreateTicketModal({ project, onClose, onCreated }: CreateTicketModalProps) {
  const [subject, setSubject] = useState('');
  const [instructions, setInstructions] = useState('');
  const [yolo, setYolo] = useState(true);
  const [autoMerge, setAutoMerge] = useState(true);
  const [queued, setQueued] = useState(false);
  const [useRalph, setUseRalph] = useState(false);
  const [useTeam, setUseTeam] = useState(false);
  const [planOnly, setPlanOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [images, setImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        setImages(prev => [...prev, {
          id: `img-${++nextImageId}`,
          dataUrl: reader.result as string,
          name: file.name,
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addFiles(imageFiles);
    }
  }

  function removeImage(id: string) {
    setImages(prev => prev.filter(img => img.id !== id));
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
          queued,
          useRalph,
          useTeam,
          planOnly,
        }),
      });
      if (!res.ok) return;

      const ticket = await res.json();

      // Upload images to the newly created ticket
      for (const img of images) {
        await fetch(`/api/tickets/${ticket.id}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: img.dataUrl, originalName: img.name }),
        });
      }

      onCreated();
      onClose();
    } catch (err) {
      console.error('Failed to create ticket:', err);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form ref={formRef} onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
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
              onPaste={handlePaste}
              placeholder="Full prompt for the agent. Paste screenshots here with Cmd+V..."
              rows={6}
              className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent-blue transition-colors font-mono leading-relaxed resize-y"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Paste screenshots (Cmd+V) or drag images onto this form. The agent will receive them as context.
            </p>
          </div>

          {/* Image attachments */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Images {images.length > 0 && <span className="text-slate-500">({images.length})</span>}
            </label>

            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {images.map(img => (
                  <div key={img.id} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-20 h-20 object-cover rounded-lg border border-surface-600"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-accent-red text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Remove image ${img.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <p className="text-[9px] text-slate-500 truncate w-20 mt-0.5">{img.name}</p>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-surface-500 hover:border-accent-blue/50 hover:bg-surface-900/50 text-slate-400 hover:text-slate-300 transition-colors text-xs w-full justify-center"
            >
              <ImagePlus className="w-4 h-4" />
              Add images
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {/* Options grid */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Options
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setYolo(!yolo)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  yolo
                    ? 'bg-accent-amber/10 border-accent-amber/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Skip all permission prompts. Agent runs fully autonomous. Without YOLO, the ticket moves to 'Needs Approval' when waiting for tool permission."
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
                onClick={() => { if (!planOnly) setAutoMerge(!autoMerge); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  planOnly
                    ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                    : autoMerge
                      ? 'bg-accent-purple/10 border-accent-purple/30'
                      : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title={planOnly ? 'Disabled — plan-only produces a report, not mergeable code.' : 'Automatically merge PR when approved and checks pass.'}
              >
                <GitMerge className={`w-4 h-4 shrink-0 ${planOnly ? 'text-slate-600' : autoMerge ? 'text-accent-purple' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${planOnly ? 'text-slate-600' : autoMerge ? 'text-accent-purple' : 'text-slate-300'}`}>Auto-Merge</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  planOnly ? 'bg-surface-700 justify-start' : autoMerge ? 'bg-accent-purple justify-end' : 'bg-surface-600 justify-start'
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
                onClick={() => { if (!planOnly) setUseRalph(!useRalph); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  planOnly
                    ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                    : useRalph
                      ? 'bg-accent-green/10 border-accent-green/30'
                      : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title={planOnly ? "Disabled — plan-only doesn't need iterative refinement." : 'Iterative self-improving loop until criteria met.'}
              >
                <RefreshCw className={`w-4 h-4 shrink-0 ${planOnly ? 'text-slate-600' : useRalph ? 'text-accent-green' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${planOnly ? 'text-slate-600' : useRalph ? 'text-accent-green' : 'text-slate-300'}`}>Ralph Loop</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  planOnly ? 'bg-surface-700 justify-start' : useRalph ? 'bg-accent-green justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => { if (!planOnly) setUseTeam(!useTeam); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  planOnly
                    ? 'opacity-40 cursor-not-allowed bg-surface-900 border-surface-600'
                    : useTeam
                      ? 'bg-accent-blue/10 border-accent-blue/30'
                      : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title={planOnly ? "Disabled — plan-only doesn't benefit from team mode." : 'Agent spawns a team of sub-agents for heavy-lifting tasks.'}
              >
                <Users className={`w-4 h-4 shrink-0 ${planOnly ? 'text-slate-600' : useTeam ? 'text-accent-blue' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${planOnly ? 'text-slate-600' : useTeam ? 'text-accent-blue' : 'text-slate-300'}`}>Team</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  planOnly ? 'bg-surface-700 justify-start' : useTeam ? 'bg-accent-blue justify-end' : 'bg-surface-600 justify-start'
                }`}>
                  <div className="w-3 h-3 bg-white rounded-full mx-0.5 shadow-sm" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !planOnly;
                  setPlanOnly(next);
                  if (next) {
                    setAutoMerge(false);
                    setUseTeam(false);
                    setUseRalph(false);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                  planOnly
                    ? 'bg-accent-cyan/10 border-accent-cyan/30'
                    : 'bg-surface-900 border-surface-600 hover:border-surface-500'
                }`}
                title="Investigation only — agent produces a plan-report.md instead of code changes."
              >
                <FileSearch className={`w-4 h-4 shrink-0 ${planOnly ? 'text-accent-cyan' : 'text-slate-500'}`} />
                <span className={`text-xs font-medium ${planOnly ? 'text-accent-cyan' : 'text-slate-300'}`}>Plan Only</span>
                <div className={`ml-auto w-7 h-4 rounded-full transition-colors flex items-center shrink-0 ${
                  planOnly ? 'bg-accent-cyan justify-end' : 'bg-surface-600 justify-start'
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
              <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1.5 text-[10px] opacity-60 font-sans">
                <span>⌘</span><span>↵</span>
              </kbd>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
