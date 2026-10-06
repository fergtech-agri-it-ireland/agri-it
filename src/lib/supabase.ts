import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

export const supabase = createClient(url ?? 'http://127.0.0.1:54321', anon ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true }
});
