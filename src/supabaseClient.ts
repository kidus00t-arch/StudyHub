import { createClient } from '@supabase/supabase-js';

// By using 'as any' on the meta object first, we bypass Vite property warnings.
// Then, we cast the variables specifically as 'string | undefined' to avoid unsafe 'any' checks.
const env = (import.meta as any).env || {};

const supabaseUrl = env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase configuration notice: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. " +
    "Please configure them in your Netlify site environment settings."
  );
}

// Use valid placeholder values if env vars are missing to prevent top-level JS module crash (Invalid URL error)
const urlToUse = (supabaseUrl && supabaseUrl.trim() !== '') ? supabaseUrl : 'https://placeholder.supabase.co';
const keyToUse = (supabaseAnonKey && supabaseAnonKey.trim() !== '') ? supabaseAnonKey : 'placeholder-anon-key';

export const supabase = createClient(urlToUse, keyToUse);