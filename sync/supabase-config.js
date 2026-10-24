// Active Plus Coaching — Public Supabase client configuration only.
// Only public project URL and anon/publishable keys belong in client code.

export const SUPABASE_PROJECT_REF = 'cgtdnwktzcroxeioeyfq';
export const SUPABASE_URL = 'https://cgtdnwktzcroxeioeyfq.supabase.co';
export const SUPABASE_WS_URL = 'wss://cgtdnwktzcroxeioeyfq.supabase.co';

// Public anonymous client JWT + publishable key (RLS-governed anon role only).
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNndGRud2t0emNyb3hlaW9leWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NTc1MzQsImV4cCI6MjEwODQzMzUzNH0.oir8761etBDllI3K09Fy64cw_Yae5fvBefh-iOQm618';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zMPVLBbBw8Butupn_KuXNw__wAerrfi';

export const SUPABASE_REALTIME_CHANNEL = 'apc-realtime-sync-v1';

export const supabaseConfig = Object.freeze({
  projectRef: SUPABASE_PROJECT_REF,
  url: SUPABASE_URL,
  wsUrl: SUPABASE_WS_URL,
  anonKey: SUPABASE_ANON_KEY,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  realtimeChannel: SUPABASE_REALTIME_CHANNEL
});

export function isSupabaseConfigured(cfg = supabaseConfig) {
  return Boolean(
    cfg
    && typeof cfg.url === 'string'
    && cfg.url.startsWith('https://')
    && typeof cfg.anonKey === 'string'
    && cfg.anonKey.length > 40
    && typeof cfg.projectRef === 'string'
    && cfg.projectRef.length >= 10
  );
}
