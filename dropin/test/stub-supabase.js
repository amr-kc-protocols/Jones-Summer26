/* Stands in for @supabase/supabase-js during the end-to-end test.

   Same shape as the real thing where dropin/app.js touches it: a PIN
   login, and a channel carrying presence plus addressed broadcasts. The
   transport underneath is a BroadcastChannel, so two tabs in one browser
   reach each other exactly as two devices would through Supabase —
   including not receiving your own messages back. */
export function createClient() {
  let session = null;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      async signInWithPassword({ password }) {
        if (password.startsWith('1234')) { session = { access_token: 'stub-token' }; return { error: null }; }
        return { error: { message: 'Invalid login credentials' } };
      },
      async signOut() { session = null; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },
    realtime: { setAuth() {} },
    channel(name, cfg) {
      const key = cfg?.config?.presence?.key || 'anon';
      const bc = new BroadcastChannel('stub-' + name);
      const handlers = { broadcast: [], presence: [] };
      const state = {};
      let mine = null;

      const emitPresence = () => { for (const h of handlers.presence) h.cb(); };

      bc.onmessage = e => {
        const m = e.data;
        if (m.t === 'presence') { state[m.key] = [m.payload]; emitPresence(); }
        else if (m.t === 'ask') { if (mine) bc.postMessage({ t: 'presence', key, payload: mine }); }
        else if (m.t === 'broadcast') {
          for (const h of handlers.broadcast) if (h.filter?.event === m.event) h.cb({ payload: m.payload });
        }
      };

      const api = {
        on(type, filter, cb) { (handlers[type] ||= []).push({ filter, cb }); return api; },
        subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 20); return api; },
        presenceState() { return state; },
        async track(payload) {
          mine = payload;
          state[key] = [payload];
          bc.postMessage({ t: 'presence', key, payload });
          bc.postMessage({ t: 'ask' });
          emitPresence();
        },
        send({ event, payload }) { bc.postMessage({ t: 'broadcast', event, payload }); }
      };
      return api;
    }
  };
}
