import { createClient } from '@supabase/supabase-js';

// By using 'as any' on the meta object first, we bypass Vite property warnings.
// Then, we cast the variables specifically as 'string | undefined' to avoid unsafe 'any' checks.
const env = (import.meta as any).env || {};

const supabaseUrl = env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Supabase configuration error: Missing environment variables! " +
    "Verify that your .env.local file contains VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');