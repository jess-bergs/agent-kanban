import { useState } from 'react';
import { Shield } from 'lucide-react';
import { setApiKey } from '../lib/api';

interface LoginScreenProps {
  onAuthenticated: () => void;
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setChecking(true);
    setError('');

    try {
      // Test the key against a protected endpoint
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });

      if (res.ok) {
        setApiKey(trimmed);
        onAuthenticated();
      } else if (res.status === 401 || res.status === 403) {
        setError('Invalid API key');
      } else {
        setError(`Server error (${res.status})`);
      }
    } catch {
      setError('Cannot reach server');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="h-screen bg-surface-900 flex items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="bg-surface-800 border border-surface-600 rounded-lg p-8 w-full max-w-sm"
      >
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-6 h-6 text-accent-blue" />
          <h1 className="text-lg font-semibold text-white">Agent Kanban</h1>
        </div>

        <label className="block text-sm text-surface-300 mb-2">
          API Key
        </label>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="Enter your API key"
          autoFocus
          className="w-full bg-surface-900 border border-surface-600 rounded px-3 py-2 text-white placeholder-surface-500 focus:outline-none focus:border-accent-blue mb-4"
        />

        {error && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}

        <button
          type="submit"
          disabled={checking || !key.trim()}
          className="w-full bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
        >
          {checking ? 'Checking...' : 'Log In'}
        </button>
      </form>
    </div>
  );
}
