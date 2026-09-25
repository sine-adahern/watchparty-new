// Protocol types shared by the UI, the realtime layer, and the API routes.
// Mirrors the `shared` crate in the original Rust project.

export interface Video {
  id: string;
  name: string;
  url: string; // Vercel Blob public URL
}

/** Authoritative playback state broadcast to everyone in a room. */
export interface PlaybackState {
  playing: boolean;
  position: number; // seconds into the video
  videoId: string | null;
  updatedAt: number; // ms epoch on the sender's clock, for drift correction
}

/** A peer present in the room (Ably presence member). */
export interface Peer {
  id: string; // Ably clientId
  name: string;
}

export type SignalKind = "offer" | "answer" | "ice";

/** WebRTC signaling relayed peer-to-peer over an Ably channel. */
export interface Signal {
  from: string;
  to: string;
  kind: SignalKind;
  payload: string; // JSON-encoded SDP or ICE candidate
}

// Ably event names used on the room channel.
export const EVT_STATE = "state";
export const EVT_SIGNAL = "signal";
export const EVT_LOAD = "load";
