/* The WebRTC arrangement app.js sets up, checked in a real browser with the
   signalling hop replaced by a direct hand-off. What matters here:

     1. the camera's three m-lines land in the fixed order the viewer
        assumes — video, camera mic, talk-back;
     2. the viewer can claim that third slot as sendonly with no track on it;
     3. push-to-talk can then swap a track in and be heard WITHOUT a second
        offer/answer, which is the whole reason the slot is pre-negotiated.

   If any of this stops holding, push-to-talk starts interrupting the
   picture — or stops working — and it would be hard to see why. */
import { playwright, browser, serve, reporter } from './harness.mjs';

export default async function run() {
  const r = reporter('Drop In — WebRTC negotiation');
  const pw = await playwright();
  const { server, base } = await serve();
  const b = await browser(pw);
  const ctx = await b.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.goto(base);           // a secure context, so getUserMedia exists

  const out = await page.evaluate(async () => {
    const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const viewerMic = await navigator.mediaDevices.getUserMedia({ audio: true });

    const camPc = new RTCPeerConnection(), viewPc = new RTCPeerConnection();
    camPc.onicecandidate = e => e.candidate && viewPc.addIceCandidate(e.candidate);
    viewPc.onicecandidate = e => e.candidate && camPc.addIceCandidate(e.candidate);

    // exactly what peerForViewer() builds
    camPc.addTransceiver(cameraStream.getVideoTracks()[0], { direction: 'sendonly', streams: [cameraStream] });
    camPc.addTransceiver(cameraStream.getAudioTracks()[0], { direction: 'sendonly', streams: [cameraStream] });
    camPc.addTransceiver('audio', { direction: 'recvonly' });

    let talkbackTrack = null;
    camPc.ontrack = e => { talkbackTrack = e.track; };
    const viewerGot = { video: false, audio: false };
    viewPc.ontrack = e => { viewerGot[e.track.kind] = true; };

    await camPc.setLocalDescription(await camPc.createOffer());
    const mlines = (camPc.localDescription.sdp.match(/^m=(\w+)/gm) || []).map(s => s.slice(2));

    // exactly what viewerHandle('offer') does
    await viewPc.setRemoteDescription({ type: 'offer', sdp: camPc.localDescription.sdp });
    const talkback = viewPc.getTransceivers().filter(t => t.receiver.track?.kind === 'audio').pop();
    talkback.direction = 'sendonly';                       // no track on it yet
    await viewPc.setLocalDescription(await viewPc.createAnswer());
    await camPc.setRemoteDescription({ type: 'answer', sdp: viewPc.localDescription.sdp });

    const connected = await new Promise(res => {
      const t = setTimeout(() => res(false), 15000);
      const check = () => {
        if (camPc.connectionState === 'connected') { clearTimeout(t); res(true); }
        if (camPc.connectionState === 'failed') { clearTimeout(t); res(false); }
      };
      camPc.onconnectionstatechange = check; check();
    });

    let renegotiated = false;
    viewPc.onnegotiationneeded = camPc.onnegotiationneeded = () => { renegotiated = true; };
    await talkback.sender.replaceTrack(viewerMic.getAudioTracks()[0]);
    await new Promise(r => setTimeout(r, 3000));

    let inboundAudio = 0, outboundVideo = 0;
    (await camPc.getStats()).forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') inboundAudio = s.bytesReceived || 0;
      if (s.type === 'outbound-rtp' && s.kind === 'video') outboundVideo = s.bytesSent || 0;
    });
    await talkback.sender.replaceTrack(null);

    return { mlines, connected, renegotiated, viewerGot, inboundAudio, outboundVideo,
             talkbackArrived: !!talkbackTrack, stable: viewPc.signalingState === 'stable' };
  });

  r.note('m-line order: ' + out.mlines.join(', '));
  r.ok(JSON.stringify(out.mlines) === JSON.stringify(['video', 'audio', 'audio']),
       'm-lines are video, audio, audio — the order the viewer counts on');
  r.ok(out.connected, 'the two peers connect');
  r.ok(out.viewerGot.video && out.viewerGot.audio, 'viewer receives the room’s picture and sound');
  r.ok(out.outboundVideo > 0, 'video actually flows to the viewer');
  r.ok(out.talkbackArrived, 'camera sees a talk-back track');
  r.ok(out.inboundAudio > 0, 'push-to-talk audio reaches the camera', out.inboundAudio + ' bytes');
  r.ok(!out.renegotiated, 'push-to-talk needs no second offer/answer');
  r.ok(out.stable, 'signalling stays stable throughout');

  await b.close();
  server.close();
  return r.done();
}
