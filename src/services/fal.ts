import { fal } from "@fal-ai/client";
import { config } from "../config";

fal.config({ credentials: config.fal.key });

/**
 * Generate a face-preserving look using fal-ai/nano-banana-2/edit.
 *
 * @param faceImageUrl  Cloudinary URL of the original selfie
 * @param prompt        What to change (hairstyle / outfit)
 */
const FAL_TIMEOUT_MS = 120_000; // 2 min

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`fal.ai timed out after ${ms / 1000}s`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

export async function generateWithInstantID(
  faceImageUrl: string,
  prompt:       string
): Promise<string> {
  const result = await withTimeout(
    fal.subscribe("xai/grok-imagine-image/quality/edit", {
      input: {
        image_url: faceImageUrl,
        prompt,
      },
      logs: false,
    }),
    FAL_TIMEOUT_MS
  );

  if (process.env.NODE_ENV !== "production") {
    console.log("[fal/grok-imagine] requestId:", result.requestId);
    console.log("[fal/grok-imagine] data keys:", Object.keys(result.data ?? {}));
  }

  const data = result.data as Record<string, unknown>;

  const url =
    (data?.["images"] as Array<{ url: string }> | undefined)?.[0]?.url
    ?? (data?.["image"]  as { url?: string } | undefined)?.url
    ?? (data?.["url"]    as string | undefined);

  if (!url) {
    console.error("[fal/grok-imagine] unexpected data:", JSON.stringify(result.data).slice(0, 400));
    throw new Error(`grok-imagine returned no image. data: ${JSON.stringify(result.data).slice(0, 200)}`);
  }

  return url;
}
