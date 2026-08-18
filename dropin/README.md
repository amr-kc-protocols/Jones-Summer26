# Drop In

A camera you leave in a room and look through from your phone. The iPad in
the Laerdal shell runs the camera; the phones run the viewer.

Live video only — nothing is recorded, and nothing is stored anywhere. The
picture goes device to device over WebRTC and never passes through a server.

## Before you set it up

This is a camera pointed at your own children in your own house, which is an
ordinary thing to have. Two habits keep it that way, and the app is built
around them:

- **Shared rooms only.** Playroom, kitchen, family room. Not bedrooms, not
  bathrooms.
- **Let them know it's there.** The iPad shows a live indicator whenever
  somebody is watching, on by default, and it stays visible even with the
  screen blacked out. You can switch it off in ⚙ — but a camera in a shared
  room that says when it's on is a monitor, and one that hides it is
  something else.

Older kids will work out that a camera is a camera. Telling them beforehand
costs nothing and saves the conversation you'd otherwise have later.

## Setting it up

1. **Run the SQL.** Supabase → SQL Editor → New query → paste
   [`supabase/signal.sql`](./supabase/signal.sql) → Run. This authorises the
   household account on the signalling channel; until it's run, both devices
   sit at *Not authorised*.
2. **Merge to `main`.** GitHub Pages serves it at `/dropin/`.
3. **On each device:** open the page → **Share** → **Add to Home Screen**.
   Launch it from the home screen icon, not from Safari — a home-screen web
   app keeps its own camera permission and its own full screen.
4. Unlock with the household PIN — the same one as the calendar.
5. Pick what the device is. The iPad is **a camera**; the phones are
   **viewers**. Name the camera after its room in ⚙.

## Setting up the iPad properly

This is the part that decides whether it actually works. A web app cannot
run in the background on iPadOS: the moment Safari backgrounds the page or
the screen locks, the camera stops. So the iPad has to sit awake on this one
screen.

1. **Settings → Display & Brightness → Auto-Lock → Never.**
   The app also takes a screen wake lock, but Auto-Lock is the thing that
   actually holds on iPadOS.
2. **Keep it plugged in.** A screen that never sleeps eats a battery in a
   few hours.
3. **Guided Access** so a passing child can't swipe out of it:
   Settings → Accessibility → Guided Access → on, set a passcode. Then open
   Drop In and triple-click the top button → Start.
4. **Tap "Screen off"** in the app. The iPad goes black and looks asleep, but
   the page keeps running and the camera stays up. Triple-tap to wake it.
   Do this rather than locking the iPad — locking it kills the camera.

If you come back to the iPad and the picture is frozen, the page was
backgrounded at some point. Bring it to the front; it restarts the camera by
itself when it sees the tracks have died.

## Using it

Open Drop In on your phone. Any camera that's awake is listed; tap it and
you're looking through it in a second or two.

| Control | What it does |
|---|---|
| **Sound on** | Unmutes the room. Starts muted — iOS won't autoplay audio. |
| **Hold to talk** | Push-to-talk the other way. Your voice comes out of the iPad. |
| **Photo** | Freezes a still. Touch and hold it → *Save to Photos*. |
| **Fill / Fit** | Whether the picture fills the phone or fits inside it. |
| **Done** | Hangs up. So does leaving the app. |

On the iPad: **Switch camera** cycles front and back, **Mic** mutes what the
room sends, **Screen off** blacks out the display, ⚙ has the name, the
picture quality, the live indicator and the drop-in chime.

## How it works

| File | What it does |
|---|---|
| `index.html` | Markup and all styling |
| `app.js` | Lock screen, signalling, WebRTC, both roles |
| `config.js` | Supabase keys, PIN salt, STUN/TURN, defaults |
| `sw.js` | Offline shell |
| `supabase/signal.sql` | Who may join the signalling channel |

Two devices that want to talk have to find each other and swap a description
of what they can send. That handshake is a few kilobytes and it rides on a
Supabase realtime channel — the same project the calendar uses, no new
server, no new account. Nothing is written to a table; the channel is a pipe.
Once the handshake lands, the two devices hold a direct connection and
Supabase is out of the picture entirely.

The camera offers three streams in a fixed order every time: its video, its
microphone, and an empty slot pointing back the other way for talk-back. The
fixed order is what lets push-to-talk work later by swapping a track into
that slot, with no second handshake and no interruption to the picture.

A camera keeps the same identity across reloads, so refreshing the iPad
doesn't turn "Playroom" into a stranger. Each viewer gets its own connection,
so two phones can watch the same room at once.

## Security

One shared household login, unlocked with the PIN — the calendar's PIN, the
calendar's account.

The signalling channel is a Supabase **private** channel. Private channels
are authorised by row-level security, and `supabase/signal.sql` grants the
`dropin-` topics to that one account and nothing else. This is the whole
reason for step 1: the anon key in `config.js` is public by design, and on an
ordinary public channel anyone holding it could listen to the handshake and
ask the camera for a stream.

The video itself is peer-to-peer and encrypted by WebRTC (DTLS-SRTP) whether
or not it leaves the house. Nobody in the middle sees it, because there is no
middle.

The honest limit is the same one the calendar has: a 4–6 digit PIN is short,
and what stands between it and a determined guesser is Supabase's auth
rate-limiting. That's a fair trade for a camera in a playroom.

## Tests

```sh
node dropin/test/run.mjs
```

Two suites, both in a real browser with a fake camera in it.

`negotiation.mjs` pins down the WebRTC arrangement: that the camera's three
streams come out in the fixed order the viewer counts on, and that
push-to-talk can swap a track into the pre-negotiated slot **without** a
second handshake. If that ever stops holding, talking would start
interrupting the picture, and it would be hard to see why from the symptom.

`e2e.mjs` drives the real `app.js` in two tabs — one camera, one viewer —
with only the Supabase hop replaced by a stub, so the lock screen, the
handshake, the connection and every control are the shipped code. It checks
the whole round trip: a wrong PIN is refused, the camera captures, the phone
lists it and sees the room, the indicator lights on the iPad, sound, photo,
push-to-talk, blacking out the screen without dropping the picture, two
phones at once, hanging up, and the iPad keeping its identity across a
reload.

Needs Playwright with Chromium (`npm i -g playwright && npx playwright
install chromium`). No keys, no network, no Supabase project.

## Limits worth knowing

- **The iPad has to be awake with the app open.** There is no way around this
  in a web app on iPadOS. If you want a camera that survives a locked screen,
  you want a real camera.
- **Nothing is recorded.** No history, no motion alerts, no clips. It's a
  window, not a DVR.
- **Away from home may need a relay.** On your own wi-fi it always connects.
  From outside, it usually does — but behind a symmetric NAT or on some
  mobile networks the two ends can't reach each other directly, and you'd
  need a TURN relay. If watching from away hangs at *Connecting*, set `TURN`
  in `config.js`. Note that a relay puts a third party's server in the video
  path, which is the one thing the rest of this design avoids.
- **One PIN for the household**, so the app can't tell which of you is
  watching, and neither can the iPad.
