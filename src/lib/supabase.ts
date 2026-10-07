import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IN_BROWSER } from './env';
import { createDemoClient } from './demo/client';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = IN_BROWSER || Boolean(url && anon);

// The demo and phone-only builds swap in an in-browser stand-in with the same surface the app uses.
export const supabase: SupabaseClient = IN_BROWSER
  ? (createDemoClient() as unknown as SupabaseClient)
  : createClient(url ?? 'http://127.0.0.1:54321', anon ?? 'missing-anon-key', {
      auth: { persistSession: true, autoRefreshToken: true }
    });
