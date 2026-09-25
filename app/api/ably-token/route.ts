import { NextResponse } from "next/server";
import Ably from "ably";

export const dynamic = "force-dynamic";

// Issues a short-lived Ably token to the browser so the realtime API key never
// ships to the client. Each visitor gets a random clientId used as their peer id.
export async function GET() {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ABLY_API_KEY is not set" },
      { status: 500 }
    );
  }

  const client = new Ably.Rest(key);
  const clientId = "u_" + Math.random().toString(36).slice(2, 10);
  const tokenRequest = await client.auth.createTokenRequest({ clientId });
  return NextResponse.json(tokenRequest);
}
