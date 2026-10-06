import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { bindAudioUnlock } from '../lib/alert-notify';
import { formatApiError } from '../lib/format-api-error';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => (
    new URLSearchParams(window.location.search).get('reason') === 'deactivated'
      ? 'Your account has been locked. Contact the AMS admin.'
      : ''
  ));
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
      setError(formatApiError(err, 'Sign in failed — check username/password or try again'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-landing">
      <aside className="login-landing__brand">
        <div className="login-landing__stage">
          <p className="login-landing__kicker">Account Management System</p>

          <div className="login-landing__hero-stack">
            <h1 className="login-landing__display">
              <span className="login-landing__display-line">AMS</span>
            </h1>
            <div className="login-landing__hero-figure" aria-hidden>
              <img
                className="login-landing__hero-img"
                src="/ams-login-hero.png"
                alt=""
                width={736}
                height={736}
                decoding="async"
              />
            </div>
          </div>

          <p className="login-landing__support">
            Accounts, SIMs, and delivery — register through standby in one workflow.
          </p>

          <div className="login-landing__meta">
            <div className="login-landing__chips">
              <span className="login-landing__chip">Accounts</span>
              <span className="login-landing__chip">SIM Ledger</span>
            </div>
            <div className="login-landing__stats">
              <div className="login-landing__stat">
                <strong>AMS</strong>
                <span>Platform</span>
              </div>
              <div className="login-landing__stat">
                <strong>24/7</strong>
                <span>Ops desk</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="login-landing__main">
        <form className="login-landing__form" onSubmit={handleSubmit}>
          <header className="login-landing__form-head">
            <h2 className="login-landing__form-title">Welcome back</h2>
            <p className="login-landing__form-sub">Sign in to continue to AMS.</p>
          </header>

          <label className="login-landing__field">
            <span className="login-landing__label">Username</span>
            <input
              type="text"
              className="login-landing__input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="your.username"
              required
            />
          </label>

          <label className="login-landing__field">
            <span className="login-landing__label">Password</span>
            <input
              type="password"
              className="login-landing__input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="login-landing__error" role="alert">{error}</p> : null}

          <button type="submit" className="login-landing__submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-landing__hint">Need access? Ask your admin.</p>
        </form>
      </main>
    </div>
  );
}
