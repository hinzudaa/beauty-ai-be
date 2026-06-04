import { fal } from "@fal-ai/client";
import { config } from "../config";

fal.config({ credentials: config.fal.key });

/**
 * Generate a face-preserving look using FLUX.1 Dev image-to-image.
 * Cheapest high-quality option: $0.025/image.
 *
 * @param faceImageUrl  Cloudinary URL of the original selfie
 * @param prompt        What to change (hairstyle / outfit)
 */
export async function generateWithInstantID(
  faceImageUrl: string,
  prompt:       string
): Promise<string> {
  const raw = await fal.subscribe("fal-ai/flux/dev/image-to-image", {
    input: {
      image_url:           faceImageUrl,
      prompt,
      strength:            0.65,   // 0=identical, 1=fully new — 0.65 keeps face, changes style
      num_inference_steps: 28,
      guidance_scale:      3.5,
    },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("[fal/flux-dev] keys:", Object.keys(raw ?? {}));
  }

  const data  = (raw as Record<string, unknown>);
  const inner = (data?.["data"] ?? data) as Record<string, unknown>;

  const url =
    (inner?.["images"] as Array<{ url: string }> | undefined)?.[0]?.url
    ?? (inner?.["image"] as { url?: string } | undefined)?.url;

  if (!url) {
    console.error("[fal/flux-dev] unexpected response:", JSON.stringify(raw).slice(0, 400));
    throw new Error(`FLUX Dev returned no image. Response: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  return url;
}
