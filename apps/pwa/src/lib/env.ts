const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen. Lege apps/pwa/.env nach dem Muster von .env.example an.",
  );
}

export const env = { supabaseUrl, supabaseAnonKey };
