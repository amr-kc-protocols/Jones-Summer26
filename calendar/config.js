// ── Jones Family Calendar — configuration ──────────────────
//
// Fill in the two values below from your Supabase project:
//   Supabase dashboard → Project Settings → API
//
//   SUPABASE_URL       ← "Project URL"
//   SUPABASE_ANON_KEY  ← "Project API keys" → anon / public
//
// Use the *anon public* key. Never the service_role key — that one
// bypasses row-level security and must not go in a web page.
//
// Both values are safe to commit. The anon key is designed to be
// public; what actually protects the calendar is row-level security
// plus the PIN. See supabase/SETUP.md.

export const SUPABASE_URL = 'PASTE_YOUR_PROJECT_URL_HERE';
export const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_PUBLIC_KEY_HERE';

// The shared household account created in SETUP.md step 4.
export const HOUSEHOLD_EMAIL = 'family@jonescalendar.local';

// Appended to the PIN you type to form the real password, so a short
// PIN is not the whole password. Must match what you set in step 4.
// Changing this means resetting the account password to match.
export const PIN_SALT = '4_Cq8PkCaiuZi62ya65yN7EwSRGyPNWK';

// Show US holidays on the grid, like the printed calendar does.
export const SHOW_HOLIDAYS = true;
