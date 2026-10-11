import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useFarmCtx } from '../lib/data/farm';
import { supabase } from '../lib/supabase';
import { Button, Card, Screen } from '../components/ui';
import { key } from '../lib/env';

/** Opening an invitation link: join the farm once signed in with the invited email. */
export default function Join() {
  const { token } = useParams();
  const { session, sessionLoading, selectFarm, refreshFarms } = useFarmCtx();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session || !token) return;
    supabase.rpc('accept_farm_invite', { p_token: token }).then(async ({ data, error: e }) => {
      if (e) { setError(e.message); return; }
      await refreshFarms();
      selectFarm(String(data));
      nav('/', { replace: true });
    });
  }, [session, token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (sessionLoading) return null;
  if (!session) {
    // Kept in localStorage: confirming a new account's email may open a new tab
    try { localStorage.setItem(key('join'), token ?? ''); } catch { /* ignore */ }
    return <Navigate to="/login" replace />;
  }
  return (
    <Screen title="Joining the farm">
      <Card>{error ? <><p className="font-bold text-danger">{error}</p><Button className="mt-3" block onClick={() => nav('/')}>Go to Agri-It</Button></> : <p>One moment…</p>}</Card>
    </Screen>
  );
}
