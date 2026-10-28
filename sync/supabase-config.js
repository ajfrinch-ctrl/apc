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

// Arena previews are untrusted development origins. The Firebase leg already
// rejects production there; the Supabase leg must do the same, including when
// a caller selects it explicitly. Do not silently redirect to another cloud:
// without a separately configured development project, keep the local outbox
// intact and report the cloud as unavailable instead.
export function isSupabasePreviewHost(hostname = globalThis.location?.hostname || '') {
  return /^[a-z0-9-]+\.e2b\.app$/.test(String(hostname).toLowerCase());
}

export function isSupabaseConfigured(cfg = supabaseConfig) {
  if (isSupabasePreviewHost()) {
    // The client below uses the production config. A separate preview config
    // must never alias the production project or endpoint.
    const productionHost = new URL(SUPABASE_URL).hostname;
    try {
      if (cfg?.projectRef === SUPABASE_PROJECT_REF || new URL(cfg?.url).hostname === productionHost) return false;
    } catch { return false; }
  }
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
