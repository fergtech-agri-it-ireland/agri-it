import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { IS_DEMO } from '../lib/env';
import { useFarmCtx } from '../lib/data/farm';
import { Button, Card } from '../components/ui';
import { Logo } from '../components/Logo';

export default function Login() {
  const { session } = useFarmCtx();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent, creds?: { email: string; password: string }) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const c = creds ?? { email: email.trim(), password };
    const { data, error } = mode === 'up' && !creds
      ? await supabase.auth.signUp({ ...c, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword(c);
    setBusy(false);
    if (error) setError(error.message);
    else if (mode === 'up' && !data.session) setNotice('Check your email to confirm your account, then sign in.');
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <Logo className="h-14 w-14" />
        <div>
          <h1 className="h-display text-4xl">Agri-It</h1>
          <p className="text-muted">Feed, cash and records. Enter it once.</p>
        </div>
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 font-bold text-danger">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-ok-bg p-3 font-bold text-ok">{notice}</p>}
          <Button block disabled={busy}>{busy ? 'Please wait' : mode === 'in' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <Button variant="ghost" block className="mt-2" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'New to Agri-It? Create an account' : 'Have an account? Sign in'}
        </Button>
      </Card>
      {(import.meta.env.DEV || IS_DEMO) && (
        <Button variant="hivis" block disabled={busy} onClick={(e) => { setMode('in'); submit(e, { email: 'demo@agri-it.local', password: 'agri-it-demo' }); }}>
          Open the demo farm
        </Button>
      )}
    </div>
  );
}
