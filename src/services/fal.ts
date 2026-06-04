import { fal } from "@fal-ai/client";
import { config } from "../config";

fal.config({ credentials: config.fal.key });

/**
 * Generate a face-preserving look using fal-ai/nano-banana-2/edit.
 *
 * @param faceImageUrl  Cloudinary URL of the original selfie
 * @param prompt        What to change (hairstyle / outfit)
 */
export async function generateWithInstantID(
  faceImageUrl: string,
  prompt:       string
): Promise<string> {
  const result = await fal.subscribe("fal-ai/nano-banana-2/edit", {
    input: {
      image_urls: [faceImageUrl],   // array — required by nano-banana-2/edit
      prompt,
    },
    logs: false,
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("[fal/nano-banana-2] requestId:", result.requestId);
    console.log("[fal/nano-banana-2] data keys:", Object.keys(result.data ?? {}));
  }

  const data = result.data as Record<string, unknown>;

  const url =
    (data?.["images"] as Array<{ url: string }> | undefined)?.[0]?.url
    ?? (data?.["image"]  as { url?: string } | undefined)?.url
    ?? (data?.["url"]    as string | undefined);

  if (!url) {
    console.error("[fal/nano-banana-2] unexpected data:", JSON.stringify(result.data).slice(0, 400));
    throw new Error(`nano-banana-2 returned no image. data: ${JSON.stringify(result.data).slice(0, 200)}`);
  }

  return url;
}
