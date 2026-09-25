import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Client-upload handler. The browser calls `upload()` from `@vercel/blob/client`
// which hits this route twice: once to get a signed token (the file then streams
// straight from the browser to Blob storage, so there's no serverless body-size
// limit), and once as a completion webhook. This is what lets multi-GB videos
// upload — a plain POST body through a serverless function would be capped.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Only allow MP4s, keep the original name in the token payload.
        return {
          allowedContentTypes: ["video/mp4"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pathname }),
          maximumSizeInBytes: 4 * 1024 * 1024 * 1024, // 4 GiB cap, matches original
        };
      },
      onUploadCompleted: async () => {
        // Nothing to persist — `list()` reads straight from Blob storage.
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
