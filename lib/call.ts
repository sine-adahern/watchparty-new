// WebRTC mesh call for ~4 people, mirroring the Rust `call.rs`.
// One RTCPeerConnection per remote peer. To avoid glare (both sides offering at
// once), we use a deterministic rule: the peer with the lexicographically smaller
// id is the initiator for that pair.

import type { Signal, SignalKind } from "./types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  // To support strict NATs, add a TURN server here, e.g.:
  // { urls: "turn:your-turn-host:3478", username: "user", credential: "pass" },
];

type SendSignal = (to: string, kind: SignalKind, payload: string) => void;

export class Call {
  private myId: string;
  private send: SendSignal;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private container: HTMLElement;
  private localVideo: HTMLVideoElement;

  constructor(
    myId: string,
    localVideo: HTMLVideoElement,
    container: HTMLElement,
    send: SendSignal
  ) {
    this.myId = myId;
    this.localVideo = localVideo;
    this.container = container;
    this.send = send;
  }

  async startLocalMedia(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      this.localVideo.srcObject = this.localStream;
      this.localVideo.muted = true; // never echo your own audio
      await this.localVideo.play().catch(() => {});
    } catch {
      // No camera/mic (or denied) — sync/playback still work without a call.
      this.localStream = null;
    }
  }

  /** Tear down all peer connections (used on reconnect). */
  reset(): void {
    for (const [, pc] of this.peers) pc.close();
    this.peers.clear();
    this.container.innerHTML = "";
  }

  stop(): void {
    this.reset();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  private amInitiator(peerId: string): boolean {
    return this.myId < peerId;
  }

  private createPc(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send(peerId, "ice", JSON.stringify(e.candidate.toJSON()));
      }
    };

    pc.ontrack = (e) => {
      let el = this.container.querySelector<HTMLVideoElement>(
        `video[data-peer="${peerId}"]`
      );
      if (!el) {
        el = document.createElement("video");
        el.dataset.peer = peerId;
        el.autoplay = true;
        el.playsInline = true;
        this.container.appendChild(el);
      }
      el.srcObject = e.streams[0];
      el.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        this.removePeer(peerId);
      }
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  private removePeer(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    this.container
      .querySelector(`video[data-peer="${peerId}"]`)
      ?.remove();
  }

  /** A new peer appeared; if we're the initiator for the pair, offer to them. */
  async onPeerJoined(peerId: string): Promise<void> {
    if (peerId === this.myId || this.peers.has(peerId)) return;
    if (!this.amInitiator(peerId)) return; // the other side will offer
    const pc = this.createPc(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send(peerId, "offer", JSON.stringify(offer));
  }

  onPeerLeft(peerId: string): void {
    this.removePeer(peerId);
  }

  async onSignal(sig: Signal): Promise<void> {
    if (sig.to !== this.myId) return;
    if (sig.kind === "offer") {
      const pc = this.peers.get(sig.from) ?? this.createPc(sig.from);
      await pc.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(sig.payload))
      );
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send(sig.from, "answer", JSON.stringify(answer));
    } else if (sig.kind === "answer") {
      const pc = this.peers.get(sig.from);
      if (pc) {
        await pc.setRemoteDescription(
          new RTCSessionDescription(JSON.parse(sig.payload))
        );
      }
    } else if (sig.kind === "ice") {
      const pc = this.peers.get(sig.from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(sig.payload)));
        } catch {
          // Candidate arrived before remote description; browsers usually queue.
        }
      }
    }
  }
}
