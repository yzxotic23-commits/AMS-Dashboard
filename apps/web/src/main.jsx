import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { SiteProvider } from './context/SiteContext';
import { GovernanceDateProvider } from './context/GovernanceDateContext';
import { getWebConfig } from './lib/supabase';
import NetworkBlockedScreen from './components/NetworkBlockedScreen';
import CircuitBreakerNotice from './components/CircuitBreakerNotice';
import { bindAudioUnlock } from './lib/alert-notify';
import './index.css';

bindAudioUnlock();

function ConfigError({ message }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ams-canvas p-6">
      <div className="card max-w-md p-8">
        <h1 className="mb-2 text-lg font-bold text-ams-ink">Configuration incomplete</h1>
        <p className="mb-4 text-sm text-ams-muted">{message}</p>
        <ol className="list-decimal space-y-2 pl-4 text-xs text-ams-faint">
          <li>Add <code className="rounded bg-ams-surface-muted px-1">VITE_SUPABASE_URL</code> and <code className="rounded bg-ams-surface-muted px-1">VITE_SUPABASE_ANON_KEY</code> to <code className="rounded bg-ams-surface-muted px-1">AMS Project/.env</code></li>
          <li>Run the SQL migration in Supabase (<code className="rounded bg-ams-surface-muted px-1">supabase/migrations/001_initial_schema.sql</code>)</li>
          <li>Restart: <code className="rounded bg-ams-surface-muted px-1">npm run dev</code></li>
        </ol>
      </div>
    </div>
  );
}

const config = getWebConfig();

try {
  localStorage.removeItem('ams-reg-queue');
} catch {
  /* ignore */
}

if (!config.ok) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <ConfigError message={config.message} />,
  );
} else {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SiteProvider>
              <GovernanceDateProvider>
                <App />
                <NetworkBlockedScreen />
                <CircuitBreakerNotice />
              </GovernanceDateProvider>
            </SiteProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
