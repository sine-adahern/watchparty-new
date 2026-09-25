import dynamic from "next/dynamic";

// The whole app is client-side (WebRTC, media elements, Ably realtime), so load
// it with SSR disabled — nothing here can render on the server.
const WatchParty = dynamic(() => import("./WatchParty"), { ssr: false });

export default function Page() {
  return <WatchParty />;
}
