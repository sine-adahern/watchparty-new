"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Type-only import: erased at compile time, so Ably's browser bundle is never
// run through the Next/SWC compiler (which mis-compiles it). The runtime library
// is loaded from Ably's CDN in `loadAbly()` below.
import type { Realtime, RealtimeChannel } from "ably";
import { upload } from "@vercel/blob/client";

// Ably's global from the CDN script.
declare global {
  interface Window {
    Ably?: { Realtime: new (opts: unknown) => Realtime };
  }
}

const ABLY_CDN = "https://cdn.ably.com/lib/ably.min-2.js";

function loadAbly(): Promise<{ Realtime: new (opts: unknown) => Realtime }> {
  return new Promise((resolve, reject) => {
    if (window.Ably) return resolve(window.Ably);
    const s = document.createElement("script");
    s.src = ABLY_CDN;
    s.async = true;
    s.onload = () =>
      window.Ably ? resolve(window.Ably) : reject(new Error("Ably not loaded"));
    s.onerror = () => reject(new Error("Failed to load Ably from CDN"));
    document.head.appendChild(s);
  });
}
import { Call } from "@/lib/call";
import {
  EVT_LOAD,
  EVT_SIGNAL,
  EVT_STATE,
  type Peer,
  type PlaybackState,
  type Signal,
  type Video,
} from "@/lib/types";

function urlRoom(): string {
  if (typeof window === "undefined") return "main";
  const p = new URLSearchParams(window.location.search).get("room");
  return p && p.trim() ? p : "main";
}

export default function WatchParty() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [current, setCurrent] = useState<Video | null>(null);
  const [status, setStatus] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [joined, setJoined] = useState(false);
  const [room, setRoom] = useState(urlRoom());
  const [name, setName] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remotesRef = useRef<HTMLDivElement>(null);

  const ablyRef = useRef<Realtime | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callRef = useRef<Call | null>(null);
  const myIdRef = useRef<string>("");
  const currentRef = useRef<Video | null>(null);
  // Ignore player events we caused ourselves while applying remote state.
  const suppressUntil = useRef(0);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/videos");
      if (res.ok) setVideos(await res.json());
    } catch {
      setStatus("Could not load library.");
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Apply an authoritative playback state to the shared player element.
  const applyState = useCallback((s: PlaybackState) => {
    if (s.videoId) {
      const cur = currentRef.current;
      if (!cur || cur.id !== s.videoId) {
        const v = videos.find((x) => x.id === s.videoId);
        if (v) setCurrent(v);
      }
    }
    suppressUntil.current = Date.now() + 700;
    const el = videoRef.current;
    if (!el) return;
    // Account for time elapsed since the sender stamped the state.
    const elapsed = s.playing ? (Date.now() - s.updatedAt) / 1000 : 0;
    const target = s.position + elapsed;
    if (s.playing) {
      if (Math.abs(el.currentTime - target) > 0.5) el.currentTime = target;
      el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = s.position;
    }
  }, [videos]);

  const publishState = useCallback((playing: boolean, position: number) => {
    const ch = channelRef.current;
    if (!ch) return;
    const s: PlaybackState = {
      playing,
      position,
      videoId: currentRef.current?.id ?? null,
      updatedAt: Date.now(),
    };
    ch.publish(EVT_STATE, s);
  }, []);

  const doJoin = useCallback(async () => {
    if (joined) return;
    setJoined(true);
    setStatus(`Joining “${room}”…`);

    try {
      const AblyLib = await loadAbly();
      const client = new AblyLib.Realtime({ authUrl: "/api/ably-token" });
      ablyRef.current = client;
      await client.connection.once("connected");
      const myId = client.auth.clientId || "me";
      myIdRef.current = myId;

      const call = new Call(
        myId,
        localVideoRef.current!,
        remotesRef.current!,
        (to, kind, payload) => {
          channelRef.current?.publish(EVT_SIGNAL, {
            from: myId,
            to,
            kind,
            payload,
          } as Signal);
        }
      );
      callRef.current = call;
      await call.startLocalMedia();

      const channel = client.channels.get(`room:${room}`);
      channelRef.current = channel;

      // Realtime playback state.
      channel.subscribe(EVT_STATE, (msg) => {
        if (msg.clientId === myId) return;
        applyState(msg.data as PlaybackState);
      });
      // Someone loaded a different video.
      channel.subscribe(EVT_LOAD, (msg) => {
        if (msg.clientId === myId) return;
        applyState(msg.data as PlaybackState);
      });
      // WebRTC signaling relay.
      channel.subscribe(EVT_SIGNAL, (msg) => {
        const sig = msg.data as Signal;
        if (sig.from === myId) return;
        call.onSignal(sig);
      });

      // Presence = who's watching.
      const refreshPresence = async () => {
        const members = await channel.presence.get();
        setPeers(
          members.map((m) => ({
            id: m.clientId || "?",
            name: (m.data as { name?: string })?.name || "guest",
          }))
        );
      };
      channel.presence.subscribe("enter", (m) => {
        refreshPresence();
        if (m.clientId && m.clientId !== myId) call.onPeerJoined(m.clientId);
      });
      channel.presence.subscribe("leave", (m) => {
        refreshPresence();
        if (m.clientId) call.onPeerLeft(m.clientId);
      });

      await channel.presence.enter({
        name: name.trim() || "guest",
      });
      await refreshPresence();

      // Offer to peers already in the room (initiator rule inside Call).
      const existing = await channel.presence.get();
      for (const m of existing) {
        if (m.clientId && m.clientId !== myId) call.onPeerJoined(m.clientId);
      }

      setStatus("Connected");
    } catch (e) {
      setStatus(`Connection failed: ${(e as Error).message}`);
      setJoined(false);
    }
  }, [joined, room, name, applyState]);

  useEffect(() => {
    return () => {
      callRef.current?.stop();
      channelRef.current?.presence.leave();
      ablyRef.current?.close();
    };
  }, []);

  // Player event handlers -> broadcast, unless we're applying remote state.
  const onPlay = () => {
    if (Date.now() >= suppressUntil.current && videoRef.current) {
      publishState(true, videoRef.current.currentTime);
    }
  };
  const onPause = () => {
    if (Date.now() >= suppressUntil.current && videoRef.current) {
      publishState(false, videoRef.current.currentTime);
    }
  };
  const onSeeked = () => {
    if (Date.now() >= suppressUntil.current && videoRef.current) {
      publishState(!videoRef.current.paused, videoRef.current.currentTime);
    }
  };

  const pickVideo = (v: Video) => {
    setCurrent(v);
    currentRef.current = v;
    const ch = channelRef.current;
    if (ch) {
      const s: PlaybackState = {
        playing: false,
        position: 0,
        videoId: v.id,
        updatedAt: Date.now(),
      };
      ch.publish(EVT_LOAD, s);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Uploading ${file.name}…`);
    try {
      await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: "video/mp4",
      });
      setStatus(`Uploaded ${file.name}`);
      await loadLibrary();
    } catch (err) {
      setStatus(`Upload failed: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  const deleteVideo = async (v: Video) => {
    try {
      await fetch(`/api/videos?url=${encodeURIComponent(v.url)}`, {
        method: "DELETE",
      });
      if (currentRef.current?.id === v.id) {
        setCurrent(null);
        currentRef.current = null;
      }
      await loadLibrary();
    } catch {
      setStatus("Delete failed.");
    }
  };

  const copyInvite = () => {
    const link = `${window.location.origin}/?room=${encodeURIComponent(room)}`;
    navigator.clipboard.writeText(link).then(
      () => setStatus("Invite link copied"),
      () => setStatus(link)
    );
  };

  return (
    <main className="wrap">
      <h1>Watch Party</h1>

      {!joined ? (
        <div className="join">
          <input
            className="inp"
            placeholder="room code"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <input
            className="inp"
            placeholder="your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={doJoin}>Join</button>
        </div>
      ) : (
        <div className="room-bar">
          <span>
            In room “{room}” · {Math.max(peers.length, 1)} watching
          </span>
          <button className="link" onClick={copyInvite}>
            Copy invite link
          </button>
        </div>
      )}

      <p className="status">{status}</p>

      <div className="call">
        <video ref={localVideoRef} className="me" playsInline muted />
        <div ref={remotesRef} className="remotes" />
      </div>

      {current ? (
        <video
          ref={videoRef}
          className="player"
          controls
          src={current.url}
          onPlay={onPlay}
          onPause={onPause}
          onSeeked={onSeeked}
        />
      ) : (
        <p className="empty">Pick a video from the library to start.</p>
      )}

      <label className="upload">
        Upload MP4:
        <input type="file" accept="video/mp4" onChange={onUpload} />
      </label>

      <h2>Library</h2>
      <ul className="library">
        {videos.map((v) => (
          <li key={v.id}>
            <button className="pick" title={v.name} onClick={() => pickVideo(v)}>
              <video className="thumb" src={`${v.url}#t=0.5`} preload="metadata" muted playsInline />
              <span className="name">{v.name}</span>
            </button>
            <button className="del" title="Delete" onClick={() => deleteVideo(v)}>
              ×
            </button>
          </li>
        ))}
      </ul>

      {joined && (
        <>
          <h2>Watching now</h2>
          <ul className="peers">
            {peers.map((p) => (
              <li key={p.id}>
                {p.id === myIdRef.current ? `${p.name} (you)` : p.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
