// Shared Supabase client for the Private Mentorship website.
// Loaded by every page that needs to talk to the backend.
// The anon key is safe to expose in browser code — RLS policies enforce access.

const SUPABASE_URL = 'https://llkicgphkvciumfzhbkk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_s4CSPmTNGAuQ3TBuXlR3fA_-1QseuRf';

// Loaded from CDN <script> tag in each HTML page; provides window.supabase.createClient
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'pm-website-auth',
  },
});

window.pmSupabase = sb;
