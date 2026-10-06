import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IS_DEMO } from './env';
import { createDemoClient } from './demo/client';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = IS_DEMO || Boolean(url && anon);

// The demo build swaps in an in-browser stand-in with the same surface the app uses.
export const supabase: SupabaseClient = IS_DEMO
  ? (createDemoClient() as unknown as SupabaseClient)
  : createClient(url ?? 'http://127.0.0.1:54321', anon ?? 'missing-anon-key', {
      auth: { persistSession: true, autoRefreshToken: true }
    });
