import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { bindAudioUnlock } from '../lib/alert-notify';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    bindAudioUnlock();
    setError('');
    setLoading(true);
    try {
      await signIn(username.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ams-canvas px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ams-accent text-white">
            <LayoutDashboard size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">AMS Platform</h1>
            <p className="text-xs text-ams-muted">Account Management System</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ams-muted">Username</label>
            <input
              type="text"
              className="input font-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="admin"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ams-muted">Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-xs text-ams-danger">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-ams-faint">
          Contact admin if you need an account.
        </p>
      </div>
    </div>
  );
}
