/* ══════════════════════════════════════════════════════════
   Drop In — look through a camera in the house from a phone.

   Two roles, one page. The iPad runs as a *camera*: it holds a
   getUserMedia stream and waits. A phone runs as a *viewer*: it
   asks a camera for a stream and gets one.

   Between them, WebRTC — the video goes device to device and
   never touches a server. What does need a server is the few
   hundred bytes of handshake that let the two find each other,
   and that rides on a private Supabase realtime channel using
   the household login the calendar already has. Nothing is
   stored; the channel is a pipe, not a table.
   ══════════════════════════════════════════════════════════ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, HOUSEHOLD_EMAIL, PIN_SALT,
  SIGNAL_CHANNEL, STUN, TURN, SHOW_WATCH_INDICATOR, DEFAULT_QUALITY
} from './config.js';

/* ── tiny helpers ────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const show = (sel, on) => { $(sel).hidden = !on; };

let toastTimer = null;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem('dropin.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('dropin.' + k, JSON.stringify(v)); } catch {} }
};

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/* ── config guard ────────────────────────────────────────── */
if (!SUPABASE_URL || SUPABASE_URL.startsWith('PASTE') ||
    !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('PASTE')) {
  show('#setup', true);
  throw new Error('Supabase not configured — see dropin/README.md');
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // Its own storage key so signing out here doesn't sign out the calendar
  // on the same phone, and vice versa.
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dropin-auth' }
});

const ICE = [{ urls: STUN }].concat(TURN ? [TURN] : []);

const QUALITY = {
  low:    { width: 640,  height: 360,  fps: 20, bitrate:  400_000 },
  medium: { width: 1280, height: 720,  fps: 24, bitrate: 1_200_000 },
  high:   { width: 1920, height: 1080, fps: 24, bitrate: 2_500_000 }
};

/* ══ identity ════════════════════════════════════════════
   A camera keeps the same id across reloads, so the phone sees
   "Playroom" rather than a new stranger every time the iPad
   refreshes. A viewer is disposable and gets a fresh one. */
let CAM_ID = store.get('camId');
if (!CAM_ID) { CAM_ID = 'cam_' + rid(); store.set('camId', CAM_ID); }

let role = new URL(location.href).searchParams.get('role') || store.get('role');
let MYID = null;                       // set once the role is known

/* ══ settings ════════════════════════════════════════════ */
const settings = {
  name:      store.get('name', 'Camera'),
  quality:   store.get('quality', DEFAULT_QUALITY),
  indicator: store.get('indicator', SHOW_WATCH_INDICATOR),
  chime:     store.get('chime', true),
  stats:     store.get('stats', false)
};
const saveSetting = (k, v) => { settings[k] = v; store.set(k, v); };

/* ══════════════════════════════════════════════════════════
   Lock screen — the household PIN, same one as the calendar.
   ══════════════════════════════════════════════════════════ */
let pin = '', unlocking = false;

function renderDots() {
  const box = $('#lockDots');
  box.replaceChildren();
  const n = Math.max(4, pin.length);
  for (let i = 0; i < n; i++) box.append(el('div', 'd' + (i < pin.length ? ' on' : '')));
}

function buildPad() {
  const pad = $('#pad');
  pad.replaceChildren();
  for (const k of ['1','2','3','4','5','6','7','8','9','clear','0','go']) {
    if (k === 'clear') {
      const b = el('button', 'fn', 'Clear');
      b.onclick = () => { pin = ''; renderDots(); };
      pad.append(b);
    } else if (k === 'go') {
      const b = el('button', 'fn', 'Enter');
      b.onclick = submitPin;
      pad.append(b);
    } else {
      const b = el('button', null, k);
      b.onclick = () => {
        if (pin.length >= 10 || unlocking) return;
        pin += k; renderDots();
        if (navigator.vibrate) navigator.vibrate(8);
      };
      pad.append(b);
    }
  }
}

function lockHint(text, bad) {
  const n = $('#lockHint');
  n.textContent = text || '';
  n.classList.toggle('err', !!bad);
}

async function submitPin() {
  if (unlocking) return;
  if (pin.length < 4) { lockHint('PIN is at least 4 digits', true); return; }
  unlocking = true;
  lockHint('Unlocking…');
  const { error } = await sb.auth.signInWithPassword({
    email: HOUSEHOLD_EMAIL, password: pin + PIN_SALT
  });
  unlocking = false;
  if (error) {
    pin = ''; renderDots();
    lockHint(/rate|many/i.test(error.message) ? 'Too many tries — wait a moment' : 'Wrong PIN', true);
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    return;
  }
  lockHint('');
  await afterUnlock();
}

/* ══════════════════════════════════════════════════════════
   Signalling — one private realtime channel carrying presence
   (who is online) and small addressed messages (the handshake).
   ══════════════════════════════════════════════════════════ */
let channel = null;
let channelReady = false;
const sigHandlers = new Set();
const presenceHandlers = new Set();

function setLinkPill(state, text) {
  for (const sel of ['#pillLink', '#pillLink2']) {
    const p = $(sel);
    if (!p) continue;
    p.className = 'pill' + (state === 'ok' ? ' ok' : state === 'bad' ? ' bad' : '');
    p.lastElementChild.textContent = text;
  }
}

async function openChannel() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('not signed in');

  // Private channels are authorised per-request against realtime.messages,
  // so the socket needs the household token — the public anon key alone
  // must not be able to join. See supabase/signal.sql.
  try { await sb.realtime.setAuth(session.access_token); } catch { /* older clients return void */ }

  channel = sb.channel(SIGNAL_CHANNEL, {
    config: { private: true, broadcast: { self: false }, presence: { key: MYID } }
  });

  channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
    if (!payload || payload.to !== MYID) return;      // not addressed to us
    for (const h of sigHandlers) h(payload);
  });

  channel.on('presence', { event: 'sync' }, () => {
    for (const h of presenceHandlers) h(channel.presenceState());
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    channel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        channelReady = true;
        setLinkPill('ok', role === 'camera' ? 'Online' : 'Connected');
        await trackPresence();
        if (!settled) { settled = true; resolve(); }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        channelReady = false;
        const denied = /unauthor|forbidden|denied|policy/i.test(String(err && err.message || ''));
        setLinkPill('bad', denied ? 'Not authorised' : 'Reconnecting…');
        if (denied) toast('Run dropin/supabase/signal.sql in Supabase', 6000);
        if (!settled) { settled = true; denied ? reject(err || new Error('unauthorised')) : resolve(); }
      } else if (status === 'CLOSED') {
        channelReady = false;
        setLinkPill('bad', 'Offline');
      }
    });
  });

  // Realtime access tokens expire; hand the socket the new one each time.
  sb.auth.onAuthStateChange((_e, s) => { if (s) { try { sb.realtime.setAuth(s.access_token); } catch {} } });
}

function trackPresence() {
  if (!channel || !channelReady) return Promise.resolve();
  return channel.track(role === 'camera'
    ? { role: 'camera', id: CAM_ID, name: settings.name, since: Date.now() }
    : { role: 'viewer', id: MYID, since: Date.now() });
}

function sig(msg) {
  if (!channel || !channelReady) return;
  channel.send({ type: 'broadcast', event: 'sig', payload: { from: MYID, ...msg } });
}
const onSig = fn => sigHandlers.add(fn);
const onPresence = fn => presenceHandlers.add(fn);

/* ══════════════════════════════════════════════════════════
   CAMERA
   ══════════════════════════════════════════════════════════ */
const cam = {
  stream: null,
  devices: [],
  deviceIx: 0,
  micOn: true,
  peers: new Map(),     // viewerId → { pc, senders, pending }
  wakeLock: null
};

async function startCamera() {
  $('#camErr').hidden = true;
  const q = QUALITY[settings.quality] || QUALITY.medium;
  const device = cam.devices[cam.deviceIx];

  const constraints = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: {
      width:  { ideal: q.width },
      height: { ideal: q.height },
      frameRate: { ideal: q.fps },
      ...(device ? { deviceId: { exact: device.deviceId } } : { facingMode: 'user' })
    }
  };

  // iPadOS will refuse a second capture while the first is still open, so
  // let go of the old one first. If the new one then fails, the retry button
  // is what gets us back.
  if (cam.stream) {
    for (const t of cam.stream.getTracks()) t.stop();
    $('#camVideo').srcObject = null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // A camera with no microphone permission is still worth having.
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints.video });
      cam.micOn = false;
      toast('No microphone — picture only');
    } catch (e2) {
      cameraFailed(e2);
      return;
    }
  }

  cam.stream = stream;
  $('#camVideo').srcObject = stream;

  // The mic track always exists on the connection even when the mic is
  // "off" — muting is `enabled = false`, which needs no renegotiation and
  // keeps the audio m-lines in a fixed order for everyone already watching.
  for (const t of stream.getAudioTracks()) t.enabled = cam.micOn;

  // Device list is only populated with real labels once permission is
  // granted, so fill it in after the first successful getUserMedia.
  if (!cam.devices.length) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      cam.devices = all.filter(d => d.kind === 'videoinput');
      const active = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      const ix = cam.devices.findIndex(d => d.deviceId === active);
      if (ix >= 0) cam.deviceIx = ix;
    } catch {}
    $('#camFlip').disabled = cam.devices.length < 2;
  }

  // Anyone already watching gets the new tracks without renegotiating.
  // Match on the sender we kept a handle to rather than on the track it is
  // carrying — after a failed capture that track can be null.
  const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0];
  for (const peer of cam.peers.values()) {
    if (v && peer.videoSender) peer.videoSender.replaceTrack(v).catch(() => {});
    if (a && peer.audioSender) peer.audioSender.replaceTrack(a).catch(() => {});
  }

  paintCam();
}

function cameraFailed(e) {
  const m = $('#camErrMsg');
  m.textContent =
    e && e.name === 'NotAllowedError'
      ? 'Camera access was refused. Open Settings → Apps → Safari → Camera, allow it for this site, then try again.'
      : e && e.name === 'NotReadableError'
        ? 'Another app is using the camera. Close it and try again.'
        : 'Couldn’t start the camera. ' + (e?.message || '');
  $('#camErr').hidden = false;
}

function paintCam() {
  $('#camName').textContent = settings.name;
  $('#camMic').textContent = cam.micOn ? 'Mic on' : 'Mic off';
  const n = cam.peers.size;
  const pill = $('#pillWatch');
  pill.className = 'pill' + (n && settings.indicator ? ' on' : '');
  pill.lastElementChild.textContent =
    !settings.indicator ? 'Indicator off'
    : n === 0 ? 'Nobody watching'
    : n === 1 ? 'Someone watching' : n + ' watching';
  pill.firstElementChild.classList.toggle('beat', n > 0);
  $('#blackout').classList.toggle('watched', n > 0 && settings.indicator);
  $('#blackLive').textContent = n > 0 ? 'LIVE' : '';
}

/* one peer connection per viewer */
function peerForViewer(viewerId) {
  let peer = cam.peers.get(viewerId);
  if (peer) return peer;

  const pc = new RTCPeerConnection({ iceServers: ICE });
  peer = { pc, pending: [], videoSender: null, audioSender: null, createdAt: Date.now() };
  cam.peers.set(viewerId, peer);

  // Fixed m-line order for every connection: video, camera mic, talk-back.
  // The viewer relies on that order to find the talk-back slot.
  const v = cam.stream.getVideoTracks()[0];
  const a = cam.stream.getAudioTracks()[0];
  peer.videoSender = v
    ? pc.addTransceiver(v, { direction: 'sendonly', streams: [cam.stream] }).sender
    : pc.addTransceiver('video', { direction: 'sendonly' }).sender;
  peer.audioSender = a
    ? pc.addTransceiver(a, { direction: 'sendonly', streams: [cam.stream] }).sender
    : pc.addTransceiver('audio', { direction: 'sendonly' }).sender;
  pc.addTransceiver('audio', { direction: 'recvonly' });   // talk-back

  pc.onicecandidate = e => {
    if (e.candidate) sig({ kind: 'ice', to: viewerId, cand: e.candidate.toJSON() });
  };

  // The viewer talking back. Playing it out of the same iPad that is
  // capturing the room would loop, which is what echoCancellation on the
  // capture above is for — it is the browser's job, not ours.
  pc.ontrack = e => {
    // Push-to-talk swaps a track into an already-negotiated slot, which
    // carries no msid — so `e.streams` is empty and the stream has to be
    // made here rather than taken from the event.
    const s = e.streams[0] || new MediaStream([e.track]);
    let audio = document.getElementById('tb_' + viewerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'tb_' + viewerId;
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.append(audio);
    }
    audio.srcObject = s;
    audio.play().catch(() => {});
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      // 'disconnected' can recover on its own; only tear down once it can't.
      if (pc.connectionState === 'disconnected') {
        setTimeout(() => { if (pc.connectionState === 'disconnected') dropViewer(viewerId); }, 8000);
      } else {
        dropViewer(viewerId);
      }
    } else if (pc.connectionState === 'connected') {
      applyBitrate(pc);
      if (settings.chime) chime();
      paintCam();
    }
  };

  return peer;
}

function dropViewer(viewerId) {
  const peer = cam.peers.get(viewerId);
  if (!peer) return;
  try { peer.pc.close(); } catch {}
  cam.peers.delete(viewerId);
  document.getElementById('tb_' + viewerId)?.remove();
  paintCam();
}

function applyBitrate(pc) {
  const q = QUALITY[settings.quality] || QUALITY.medium;
  for (const s of pc.getSenders()) {
    if (s.track?.kind !== 'video') continue;
    const p = s.getParameters();
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = q.bitrate;
    p.encodings[0].maxFramerate = q.fps;
    s.setParameters(p).catch(() => {});
  }
}

async function cameraHandle(msg) {
  if (msg.kind === 'hello') {
    if (!cam.stream) { sig({ kind: 'busy', to: msg.from, why: 'Camera not started' }); return; }
    dropViewer(msg.from);                        // a fresh ask replaces a stale one
    const peer = peerForViewer(msg.from);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    sig({ kind: 'offer', to: msg.from, sdp: { type: 'offer', sdp: peer.pc.localDescription.sdp } });
    paintCam();

  } else if (msg.kind === 'answer') {
    const peer = cam.peers.get(msg.from);
    if (!peer) return;
    await peer.pc.setRemoteDescription(msg.sdp);
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});

  } else if (msg.kind === 'ice') {
    const peer = cam.peers.get(msg.from);
    if (!peer) return;
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(msg.cand).catch(() => {});
    else peer.pending.push(msg.cand);

  } else if (msg.kind === 'bye') {
    dropViewer(msg.from);
  }
}

/* keeping the iPad awake and the stream alive */
async function keepAwake() {
  if (!('wakeLock' in navigator)) { $('#pillAwake').hidden = false; return; }
  try {
    cam.wakeLock = await navigator.wakeLock.request('screen');
    cam.wakeLock.addEventListener('release', () => { cam.wakeLock = null; });
    $('#pillAwake').hidden = true;
  } catch {
    $('#pillAwake').hidden = false;
  }
}

function watchVisibility() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (role !== 'camera') return;
    await keepAwake();
    // iOS stops the capture when the page is backgrounded; if the tracks
    // came back dead, take the picture again and hand it to the watchers.
    const dead = !cam.stream || cam.stream.getVideoTracks().every(t => t.readyState === 'ended');
    if (dead) await startCamera();
    trackPresence();
  });
}

let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    for (const [i, f] of [660, 880].entries()) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.3);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.32);
    }
  } catch {}
}

async function runCamera() {
  show('#cam', true);
  onSig(m => cameraHandle(m).catch(e => console.warn('signal', e)));

  // A viewer that vanishes without saying goodbye — phone locked, app
  // swiped away — is noticed here rather than waited on.
  onPresence(state => {
    const alive = new Set();
    for (const list of Object.values(state)) for (const p of list) if (p.id) alive.add(p.id);
    for (const [id, peer] of cam.peers) {
      // A sync can land before the viewer that just called us shows up in it,
      // so leave a new connection alone for a bit rather than cutting it off.
      if (!alive.has(id) && Date.now() - peer.createdAt > 15000) dropViewer(id);
    }
  });

  await startCamera();
  await keepAwake();
  await trackPresence();

  $('#camRetry').onclick = () => startCamera();
  $('#camFlip').onclick = async () => {
    if (cam.devices.length < 2) return;
    cam.deviceIx = (cam.deviceIx + 1) % cam.devices.length;
    await startCamera();
  };
  $('#camMic').onclick = () => {
    cam.micOn = !cam.micOn;
    for (const t of cam.stream?.getAudioTracks() || []) t.enabled = cam.micOn;
    paintCam();
  };
  $('#camDark').onclick = () => {
    $('#blackout').hidden = false;
    // Waking the browser's audio graph needs a gesture; use this one, so a
    // chime can sound later while the screen is black.
    if (settings.chime) { try { (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()).resume(); } catch {} }
  };
  $('#camGear').onclick = openSettings;

  let taps = 0, tapTimer = null;
  $('#blackout').onclick = () => {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 700);
    if (taps >= 3) { taps = 0; $('#blackout').hidden = true; }
  };
}

/* ══════════════════════════════════════════════════════════
   VIEWER
   ══════════════════════════════════════════════════════════ */
const viewer = {
  cameras: new Map(),   // camId → { name, since }
  pc: null,
  target: null,
  pending: [],
  talkback: null,       // the transceiver we may push audio up
  micTrack: null,
  statsTimer: null,
  lastBytes: 0,
  lastAt: 0,
  attempts: 0,
  connectTimer: null
};

function renderCameras() {
  const list = $('#camList');
  list.replaceChildren();
  if (!viewer.cameras.size) {
    const e = el('div'); e.id = 'empty';
    e.append(el('b', null, 'No cameras online'));
    const s = el('span', 'muted');
    s.innerHTML = 'Open Drop In on the iPad, choose <b>A camera</b>, and leave it on that screen. It’ll show up here.';
    e.append(s);
    list.append(e);
    return;
  }
  for (const [id, c] of viewer.cameras) {
    const row = el('button', 'camRow live');
    const thumb = el('div', 'thumb');
    thumb.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/><circle cx="12" cy="12.5" r="3.6"/></svg>';
    const n = el('div', 'n');
    n.append(el('b', null, c.name || 'Camera'));
    n.append(el('span', null, 'Online · tap to look'));
    row.append(thumb, n, el('span', 'pill ok', 'Live'));
    row.onclick = () => connectTo(id, c.name);
    list.append(row);
  }
}

function stagePill(state, text) {
  const p = $('#stagePill');
  p.className = 'pill' + (state === 'ok' ? ' ok' : state === 'bad' ? ' bad' : '');
  p.lastElementChild.textContent = text;
}

async function connectTo(camId, name) {
  closeStage(false);
  viewer.target = camId;
  viewer.attempts = 0;
  $('#stageName').textContent = name || 'Camera';
  show('#stage', true);
  $('#stageMsg').hidden = false;
  $('#stageMsg').textContent = 'Connecting…';
  stagePill('', 'Connecting');
  await openPeer();
}

async function openPeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  viewer.pc = pc;
  viewer.pending = [];

  pc.ontrack = e => {
    const s = e.streams[0] || new MediaStream([e.track]);
    const v = $('#remote');
    if (v.srcObject !== s) v.srcObject = s;
    v.play().catch(() => {});
  };
  pc.onicecandidate = e => {
    if (e.candidate) sig({ kind: 'ice', to: viewer.target, cand: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      clearTimeout(viewer.connectTimer);
      viewer.attempts = 0;
      $('#stageMsg').hidden = true;
      stagePill('ok', 'Live');
      startStats();
    } else if (pc.connectionState === 'failed') {
      retryPeer('Connection dropped');
    }
  };

  sig({ kind: 'hello', to: viewer.target });

  clearTimeout(viewer.connectTimer);
  viewer.connectTimer = setTimeout(() => {
    if (viewer.pc === pc && pc.connectionState !== 'connected') retryPeer('No answer from the camera');
  }, 14000);
}

function retryPeer(why) {
  if (!viewer.target) return;
  if (++viewer.attempts > 4) {
    stagePill('bad', 'Gave up');
    $('#stageMsg').hidden = false;
    $('#stageMsg').textContent = why + '. Check the iPad is awake with Drop In open' +
      (TURN ? '.' : ', or set a TURN relay in config.js if you’re away from home.');
    return;
  }
  stagePill('bad', 'Retrying…');
  $('#stageMsg').hidden = false;
  $('#stageMsg').textContent = why + ' — trying again…';
  try { viewer.pc?.close(); } catch {}
  viewer.pc = null;
  setTimeout(() => { if (viewer.target) openPeer(); }, 1500 * viewer.attempts);
}

async function viewerHandle(msg) {
  if (msg.kind === 'offer') {
    const pc = viewer.pc;
    if (!pc || msg.from !== viewer.target) return;
    await pc.setRemoteDescription(msg.sdp);

    // The camera always offers video, its own mic, then a receive-only slot
    // for us to talk back through. Claim that third m-line so push-to-talk
    // later needs only replaceTrack, never a renegotiation.
    viewer.talkback = pc.getTransceivers()
      .filter(t => t.receiver.track?.kind === 'audio').pop() || null;
    if (viewer.talkback) { try { viewer.talkback.direction = 'sendonly'; } catch {} }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    for (const c of viewer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    sig({ kind: 'answer', to: viewer.target, sdp: { type: 'answer', sdp: pc.localDescription.sdp } });

  } else if (msg.kind === 'ice') {
    const pc = viewer.pc;
    if (!pc) return;
    if (pc.remoteDescription) await pc.addIceCandidate(msg.cand).catch(() => {});
    else viewer.pending.push(msg.cand);

  } else if (msg.kind === 'busy') {
    stagePill('bad', 'Camera busy');
    $('#stageMsg').hidden = false;
    $('#stageMsg').textContent = msg.why || 'The camera isn’t ready.';
  }
}

function startStats() {
  stopStats();
  if (!settings.stats) return;
  $('#stats').hidden = false;
  viewer.statsTimer = setInterval(async () => {
    const pc = viewer.pc;
    if (!pc) return;
    try {
      const report = await pc.getStats();
      let line = '';
      report.forEach(s => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          const now = s.timestamp, bytes = s.bytesReceived || 0;
          let kbps = 0;
          if (viewer.lastAt && now > viewer.lastAt) {
            kbps = Math.round(((bytes - viewer.lastBytes) * 8) / (now - viewer.lastAt));
          }
          viewer.lastBytes = bytes; viewer.lastAt = now;
          const dim = s.frameWidth ? `${s.frameWidth}×${s.frameHeight}` : '—';
          line = `${dim} · ${Math.round(s.framesPerSecond || 0)}fps<br>${kbps} kbps`;
        }
      });
      if (line) $('#stats').innerHTML = line;
    } catch {}
  }, 2000);
}
function stopStats() {
  clearInterval(viewer.statsTimer);
  viewer.statsTimer = null;
  viewer.lastBytes = 0; viewer.lastAt = 0;
  $('#stats').hidden = true;
}

function closeStage(sayBye = true) {
  clearTimeout(viewer.connectTimer);
  stopStats();
  if (sayBye && viewer.target) sig({ kind: 'bye', to: viewer.target });
  try { viewer.pc?.close(); } catch {}
  viewer.pc = null;
  viewer.target = null;
  viewer.talkback = null;
  if (viewer.micTrack) { viewer.micTrack.stop(); viewer.micTrack = null; }
  const v = $('#remote');
  v.srcObject = null;
  v.muted = true;
  $('#stageSound').textContent = 'Sound on';
  $('#stageSound').classList.remove('armed');
  show('#stage', false);
}

async function pushToTalk(on) {
  const btn = $('#talk');
  if (!viewer.talkback) { toast('This camera can’t take talk-back'); return; }
  if (on) {
    if (!viewer.micTrack) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }, video: false
        });
        viewer.micTrack = s.getAudioTracks()[0];
      } catch {
        toast('Microphone access was refused');
        return;
      }
    }
    await viewer.talkback.sender.replaceTrack(viewer.micTrack).catch(() => {});
    viewer.micTrack.enabled = true;
    btn.classList.add('armed');
    btn.textContent = 'Talking…';
  } else {
    if (viewer.micTrack) viewer.micTrack.enabled = false;
    await viewer.talkback.sender.replaceTrack(null).catch(() => {});
    btn.classList.remove('armed');
    btn.textContent = 'Hold to talk';
  }
}

function snapshot() {
  const v = $('#remote');
  if (!v.videoWidth) { toast('Nothing to photograph yet'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  $('#shotImg').src = c.toDataURL('image/jpeg', 0.92);
  show('#shot', true);
}

async function runViewer() {
  show('#view', true);
  onSig(m => viewerHandle(m).catch(e => console.warn('signal', e)));
  onPresence(state => {
    const next = new Map();
    for (const list of Object.values(state)) {
      for (const p of list) if (p.role === 'camera' && p.id) next.set(p.id, { name: p.name, since: p.since });
    }
    viewer.cameras = next;
    renderCameras();
    // The camera we're watching went away.
    if (viewer.target && !next.has(viewer.target) && viewer.pc?.connectionState !== 'connected') {
      stagePill('bad', 'Camera offline');
    }
  });
  renderCameras();
  await trackPresence();

  $('#viewGear').onclick = openSettings;
  $('#stageClose').onclick = () => closeStage();
  $('#stageSound').onclick = () => {
    const v = $('#remote');
    v.muted = !v.muted;
    v.play().catch(() => {});
    $('#stageSound').textContent = v.muted ? 'Sound on' : 'Sound off';
    $('#stageSound').classList.toggle('armed', !v.muted);
  };
  $('#stageShot').onclick = snapshot;
  $('#shotDone').onclick = () => show('#shot', false);
  $('#stageFit').onclick = () => {
    const v = $('#remote');
    v.classList.toggle('fill');
    $('#stageFit').textContent = v.classList.contains('fill') ? 'Fit' : 'Fill';
  };

  const talk = $('#talk');
  const down = e => { e.preventDefault(); pushToTalk(true); };
  const up = e => { e.preventDefault(); pushToTalk(false); };
  talk.addEventListener('pointerdown', down);
  talk.addEventListener('pointerup', up);
  talk.addEventListener('pointercancel', up);
  talk.addEventListener('pointerleave', up);

  // Leaving the app should hang up rather than hold the camera open.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && viewer.target) closeStage();
  });
}

/* ══════════════════════════════════════════════════════════
   Settings
   ══════════════════════════════════════════════════════════ */
function bindSwitch(sel, key, after) {
  const sw = $(sel);
  const paint = () => sw.classList.toggle('on', !!settings[key]);
  sw.onclick = () => { saveSetting(key, !settings[key]); paint(); after?.(); };
  paint();
}

function openSettings() {
  const isCam = role === 'camera';
  $('#fName').hidden = !isCam;
  $('#fQuality').hidden = !isCam;
  $('#fIndicator').hidden = !isCam;
  $('#fChime').hidden = !isCam;
  $('#fStats').hidden = isCam;
  $('#curRole').textContent = isCam ? 'camera' : 'viewer';
  $('#inName').value = settings.name;
  $('#inQuality').value = settings.quality;
  show('#settings', true);
}

function wireSettings() {
  $('#setDone').onclick = () => show('#settings', false);
  $('#ver').textContent = 'Live video only — nothing is recorded, and the picture ' +
    'goes device to device without passing through a server.';

  $('#inName').oninput = e => {
    saveSetting('name', e.target.value.slice(0, 32) || 'Camera');
    $('#camName').textContent = settings.name;
    trackPresence();
  };

  $('#inQuality').onchange = async e => {
    saveSetting('quality', e.target.value);
    if (role === 'camera') {
      await startCamera();
      for (const p of cam.peers.values()) applyBitrate(p.pc);
      toast('Picture set to ' + e.target.value);
    }
  };

  bindSwitch('#swIndicator', 'indicator', paintCam);
  bindSwitch('#swChime', 'chime');
  bindSwitch('#swStats', 'stats', () => { if (viewer.pc) startStats(); else stopStats(); });

  $('#swapRole').onclick = () => {
    store.set('role', role === 'camera' ? 'viewer' : 'camera');
    location.replace(location.pathname);
  };

  $('#signOut').onclick = async () => {
    try { await sb.auth.signOut(); } catch {}
    location.replace(location.pathname);
  };
}

/* ══════════════════════════════════════════════════════════
   Boot
   ══════════════════════════════════════════════════════════ */
async function afterUnlock() {
  show('#lock', false);

  if (role !== 'camera' && role !== 'viewer') {
    show('#choose', true);
    return;                       // pickers below call afterUnlock again
  }

  MYID = role === 'camera' ? CAM_ID : 'v_' + rid();

  try {
    await openChannel();
  } catch {
    setLinkPill('bad', 'Not authorised');
  }

  if (role === 'camera') { watchVisibility(); await runCamera(); }
  else await runViewer();
}

function wireChoose() {
  const pick = r => async () => {
    store.set('role', r);
    role = r;
    show('#choose', false);
    await afterUnlock();
  };
  $('#pickCamera').onclick = pick('camera');
  $('#pickViewer').onclick = pick('viewer');
}

async function boot() {
  buildPad();
  renderDots();
  wireChoose();
  wireSettings();

  const { data: { session } } = await sb.auth.getSession();
  if (session) await afterUnlock();
  else show('#lock', true);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// Hanging up cleanly means the other end doesn't sit on a dead connection.
window.addEventListener('pagehide', () => {
  if (role === 'viewer' && viewer.target) sig({ kind: 'bye', to: viewer.target });
  if (role === 'camera') for (const id of cam.peers.keys()) sig({ kind: 'bye', to: id });
});

boot();
