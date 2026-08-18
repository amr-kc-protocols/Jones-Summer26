// ── Drop In — configuration ────────────────────────────────
//
// This app reuses the family calendar's Supabase project. It stores
// nothing there: Supabase is used only as a signalling channel so the
// two devices can find each other and exchange the handshake that sets
// up a direct WebRTC connection. Video and audio never touch a server.
//
// The values below are copied from ../calendar/config.js. If you ever
// move the calendar to a different project, move these too.

export const SUPABASE_URL = 'https://qrwrxjejxjwkzqbadpjj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_LPuWXQmt45g_46d5tZrAJg_OxYdZ50S';

// The shared household account, and the salt appended to the PIN to form
// the real password. Same login as the calendar — same PIN.
export const HOUSEHOLD_EMAIL = 'family@jonescalendar.local';
export const PIN_SALT = '4_Cq8PkCaiuZi62ya65yN7EwSRGyPNWK';

// The realtime topic the devices meet on. It is a *private* channel:
// supabase/signal.sql restricts every topic beginning `dropin-` to the
// household account, so the public anon key above cannot listen in.
// The name must keep the `dropin-` prefix or that policy won't match.
export const SIGNAL_CHANNEL = 'dropin-signal';

// ── Connectivity ──────────────────────────────────────────
// STUN is enough on your own wi-fi, and usually enough from outside it.
// It is not enough behind a symmetric NAT or on some mobile carriers —
// for that you need a TURN relay. Set TURN below if watching from away
// from home hangs at "connecting".
//
// TURN relays the video through someone else's server, so it costs
// bandwidth and it is a third party in the path. Leave it null unless
// you need it.
//
//   export const TURN = {
//     urls: ['turn:your.turn.host:3478'],
//     username: '…',
//     credential: '…'
//   };
export const STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302'
];
export const TURN = null;

// ── Defaults ──────────────────────────────────────────────
// Show a live indicator on the iPad whenever somebody is watching.
// Kept on by default on purpose: a camera in a shared room that says
// when it's on is a monitor, and one that hides it is something else.
// This is the default for a fresh device; each device can override it
// in ⚙, and the setting is remembered there.
export const SHOW_WATCH_INDICATOR = true;

// Video sent by the camera. 'medium' suits an iPad on house wi-fi.
//   low    640×360   ~400 kbps
//   medium 1280×720  ~1.2 Mbps
//   high   1920×1080 ~2.5 Mbps
export const DEFAULT_QUALITY = 'medium';
