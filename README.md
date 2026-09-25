# Watch Party (Next.js / Vercel edition)

A synchronized home-video watch party. Upload MP4s you own, watch them together
in the browser with playback that stays in sync (play / pause / seek / switch
video), and a WebRTC video call alongside for up to ~4 people.

**No Rust, no Docker, no toolchain.** This is a Next.js app that deploys to
Vercel. You (the host) sign up for a couple of services in the browser and click
deploy; everyone joining a party just opens the link.

## Why this shape

Vercel runs serverless functions — it **cannot** host a long-lived WebSocket
server, and its functions can't accept multi-GB uploads directly. So the two
realtime-dependent pieces are handled by managed services (both have free tiers):

- **Playback sync + WebRTC signaling** → [Ably](https://ably.com) (realtime
  messaging with presence, i.e. "who's watching").
- **Video files** → [Vercel Blob](https://vercel.com/docs/storage/vercel-blob)
  storage. Uploads stream straight from the browser to Blob, so there's no
  function body-size limit.

Everything else (the UI and the small API routes) runs on Vercel.

## What's here

```
app/
  layout.tsx            root layout
  page.tsx              loads the client app (no SSR)
  WatchParty.tsx        the whole UI: join, presence, synced player, call, library
  globals.css           styles
  api/
    ably-token/route.ts token auth so the Ably key never reaches the browser
    upload/route.ts     Vercel Blob client-upload handler (big files OK)
    videos/route.ts     GET list + DELETE a video
lib/
  types.ts              shared protocol types
  call.ts               WebRTC mesh (one connection per peer, glare-free)
```

---

## Deploy (all in the browser)

### 1. Get the code onto GitHub
Put this folder in a GitHub repo (drag-and-drop upload on github.com works, or
`git init && git add . && git commit && git push`).

### 2. Create an Ably app and copy its key
1. Sign up at <https://ably.com> (free).
2. In the dashboard, create an app, open **API Keys**, and copy the **Root** key
   (it has the Publish / Subscribe / Presence capabilities this app needs).

### 3. Import the repo into Vercel
1. Sign up at <https://vercel.com> with your GitHub account.
2. **Add New → Project**, pick the repo, framework auto-detects as Next.js.
3. Before deploying, add an **Environment Variable**:
   - `ABLY_API_KEY` = the Ably root key from step 2.
4. Click **Deploy**.

### 4. Add Blob storage
1. In the new Vercel project: **Storage → Create → Blob**, and connect it to the
   project. Vercel sets the `BLOB_READ_WRITE_TOKEN` environment variable
   automatically.
2. **Redeploy** once (Deployments → ⋯ → Redeploy) so the app picks up both env
   vars.

That's it. Vercel gives you a URL like `https://watch-party-xxx.vercel.app`.
Open it, upload an MP4, enter a room code, and press play. Share the same link
(or use the **Copy invite link** button) — friends open it, enter the same room
code, and they're in sync. Camera/mic work because Vercel serves HTTPS.

---

## Run locally (optional, needs Node only)

```bash
npm install
cp .env.example .env.local   # then paste your ABLY_API_KEY and a Blob token
npm run dev                  # http://localhost:3000
```

To get a Blob token for local dev, install the Vercel CLI, run `vercel link`,
then `vercel env pull .env.local`.

---

## Notes & limits

- **Video call across strict networks.** The call uses public STUN servers only.
  For a few people this usually connects; anyone behind a strict corporate/home
  NAT may not. To fix that, add a TURN server to the `ICE_SERVERS` list in
  `lib/call.ts` (services like Twilio or Metered offer hosted TURN).
- **Mesh call size.** WebRTC mesh is fine to ~4 people; beyond that the upstream
  bandwidth per person gets heavy (same limit as the original project).
- **Ably free tier** covers small groups comfortably (generous monthly message
  and connection allowance). Check current limits on their pricing page.
- **Vercel Blob free tier** has a storage cap — delete videos you're done with
  (the × button) to stay under it. Uploads are capped at 4 GiB each in
  `app/api/upload/route.ts`.
- **Ably is loaded from its CDN** in the browser (`cdn.ably.com`) rather than
  bundled, which sidesteps a compiler incompatibility between Ably's browser
  build and Next's SWC. The server side uses the npm package normally.
