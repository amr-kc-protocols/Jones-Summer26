/* Two tabs driving the real app.js — one as the camera, one as the viewer —
   with only the Supabase hop swapped for a BroadcastChannel stub at the
   module boundary. The lock screen, the presence listing, the handshake,
   the peer connection and every control are the shipped code. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright, browser, serve, reporter } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = readFileSync(path.join(HERE, 'stub-supabase.js'), 'utf8');

export default async function run() {
  const r = reporter('Drop In — end to end');
  const pw = await playwright();
  const { server, base } = await serve();
  const b = await browser(pw);

  const errors = [];
  const ctx = await b.newContext({
    permissions: ['camera', 'microphone'],
    // the service worker would sit between the page and the stub
    serviceWorkers: 'block'
  });
  await ctx.route('**/cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' },
    body: STUB
  }));

  const open = async (role, label = role) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(label + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(label + ' console: ' + m.text()); });
    await p.goto(base + 'dropin/?role=' + role);
    await p.waitForTimeout(400);
    return p;
  };
  const unlock = async (p, pin = '1234') => {
    await p.waitForSelector('#lock:not([hidden])', { timeout: 15000 });
    for (const d of pin) await p.click(`#pad button:text-is("${d}")`);
    await p.click('#pad button:text-is("Enter")');
  };

  // ── the iPad ─────────────────────────────────────────────
  const cam = await open('camera', 'ipad');
  await unlock(cam, '9999');
  await cam.waitForTimeout(600);
  r.ok(/Wrong PIN/.test(await cam.textContent('#lockHint')), 'a wrong PIN is refused');

  await unlock(cam);
  await cam.waitForSelector('#cam:not([hidden])', { timeout: 10000 });
  await cam.waitForFunction(() => document.querySelector('#camVideo')?.videoWidth > 0,
    null, { timeout: 20000 }).catch(() => {});
  const shot = await cam.evaluate(() => ({
    w: document.querySelector('#camVideo').videoWidth,
    h: document.querySelector('#camVideo').videoHeight,
    failed: !document.querySelector('#camErr').hidden
  }));
  r.ok(shot.w > 0 && !shot.failed, 'the camera starts capturing', `${shot.w}×${shot.h}`);
  r.ok(/Nobody watching/.test(await cam.textContent('#pillWatch')), 'it reports nobody watching yet');

  await cam.click('#camGear');
  await cam.fill('#inName', 'Playroom');
  await cam.click('#setDone');
  const camId = await cam.evaluate(() => localStorage.getItem('dropin.camId'));

  // ── the phone ────────────────────────────────────────────
  const phone = await open('viewer', 'phone');
  await unlock(phone);
  await phone.waitForSelector('#view:not([hidden])', { timeout: 10000 });
  await phone.waitForSelector('.camRow', { timeout: 10000 }).catch(() => {});
  r.ok(/Playroom/.test(await phone.textContent('#camList')), 'the phone lists the camera by its room name');

  await phone.click('.camRow');
  await phone.waitForFunction(() => {
    const v = document.querySelector('#remote'); return v?.videoWidth > 0 && !v.paused;
  }, null, { timeout: 25000 }).catch(() => {});
  const live = await phone.evaluate(() => ({
    w: document.querySelector('#remote').videoWidth,
    pill: document.querySelector('#stagePill').textContent.trim(),
    msgHidden: document.querySelector('#stageMsg').hidden
  }));
  r.ok(live.w > 0, 'the phone is seeing the room', live.w + 'px wide');
  r.ok(live.pill === 'Live' && live.msgHidden, 'the stage says Live');

  await cam.waitForTimeout(800);
  r.ok(/Someone watching/.test(await cam.textContent('#pillWatch')),
       'the iPad shows the indicator while it is being watched');

  // ── the controls ─────────────────────────────────────────
  await phone.click('#stageSound');
  r.ok(await phone.evaluate(() => !document.querySelector('#remote').muted), 'sound unmutes');

  await phone.click('#stageShot');
  await phone.waitForSelector('#shot:not([hidden])', { timeout: 6000 });
  const jpeg = await phone.getAttribute('#shotImg', 'src');
  r.ok(jpeg?.startsWith('data:image/jpeg') && jpeg.length > 4000,
       'Photo captures a real still', Math.round((jpeg || '').length / 1024) + ' KB');
  await phone.click('#shotDone');

  await phone.dispatchEvent('#talk', 'pointerdown');
  await phone.waitForTimeout(2500);
  r.ok(/Talking/.test(await phone.textContent('#talk')), 'push-to-talk arms');
  r.ok(await cam.evaluate(() => [...document.querySelectorAll('audio')].some(a => a.srcObject)),
       'the iPad receives the talk-back stream');
  await phone.dispatchEvent('#talk', 'pointerup');

  await cam.click('#camDark');
  await cam.waitForTimeout(1200);
  r.ok(await cam.evaluate(() => !document.querySelector('#blackout').hidden) &&
       await phone.evaluate(() => document.querySelector('#remote').videoWidth > 0),
       'screen-off blacks the iPad without dropping the picture');
  for (let i = 0; i < 3; i++) await cam.click('#blackout');
  r.ok(await cam.evaluate(() => document.querySelector('#blackout').hidden), 'triple-tap wakes it again');

  // ── a second phone on the same camera ────────────────────
  const phone2 = await open('viewer', 'phone2');
  await unlock(phone2);
  await phone2.waitForSelector('.camRow', { timeout: 10000 }).catch(() => {});
  await phone2.click('.camRow');
  await phone2.waitForFunction(() => document.querySelector('#remote')?.videoWidth > 0,
    null, { timeout: 25000 }).catch(() => {});
  await cam.waitForTimeout(900);
  r.ok(await phone2.evaluate(() => document.querySelector('#remote').videoWidth > 0) &&
       await phone.evaluate(() => document.querySelector('#remote').videoWidth > 0),
       'two phones can watch the same room at once');
  r.ok(/2 watching/.test(await cam.textContent('#pillWatch')), 'the iPad counts both of them');

  // ── hanging up ───────────────────────────────────────────
  await phone2.close();
  await phone.click('#stageClose');
  await cam.waitForTimeout(1500);
  r.ok(await phone.evaluate(() => document.querySelector('#stage').hidden), 'Done closes the stage');
  r.ok(/Nobody watching/.test(await cam.textContent('#pillWatch')),
       'the indicator clears when the last phone hangs up');

  // ── the iPad keeps its identity across a reload ──────────
  await cam.reload();
  await unlock(cam);
  await cam.waitForSelector('#cam:not([hidden])', { timeout: 10000 });
  await cam.waitForTimeout(800);
  r.ok(await cam.evaluate(() => localStorage.getItem('dropin.camId')) === camId,
       'reloading the iPad does not turn it into a different camera');
  r.ok((await cam.textContent('#camName')).trim() === 'Playroom', 'and it remembers its name');
  await phone.waitForTimeout(1200);
  r.ok(await phone.evaluate(() => document.querySelectorAll('.camRow').length) === 1,
       'the phone still sees one camera, not two');

  r.ok(errors.length === 0, 'no page errors', errors.join(' | ') || 'clean');

  await b.close();
  server.close();
  return r.done();
}
