import { fal } from "@fal-ai/client";
import { config } from "../config";

fal.config({ credentials: config.fal.key });

/**
 * Generate a face-preserving look using fal.ai InstantID.
 * InstantID keeps the same person — only hair or outfit changes.
 *
 * @param faceImageUrl  Cloudinary URL of the original selfie
 * @param prompt        What to change (hairstyle / outfit)
 */
export async function generateWithInstantID(
  faceImageUrl: string,
  prompt:       string
): Promise<string> {
  const raw = await fal.subscribe("fal-ai/instantid", {
    input: {
      face_image_url:                faceImageUrl,
      prompt,
      negative_prompt:               "deformed, ugly, blurry, low quality, bad anatomy, extra limbs, disfigured, same hair, unchanged hair, no hairstyle change",
      num_inference_steps:           40,
      guidance_scale:                7.5,   // higher = follows prompt more strictly
      controlnet_conditioning_scale: 0.7,   // slightly lower = allows more style change
      ip_adapter_scale:              0.8,   // keep face identity
      image_size:                    "square_hd",
    },
  });

  // Log the full response structure in dev so we can debug shape changes
  if (process.env.NODE_ENV !== "production") {
    console.log("[fal] raw response keys:", Object.keys(raw ?? {}));
  }

  // fal-ai/instantid returns: { data: { image: { url } } }
  // (singular image object, not an images array)
  const data = (raw as Record<string, unknown>);
  const inner = (data?.["data"] ?? data) as Record<string, unknown>;

  const url =
    (inner?.["image"]  as { url?: string } | undefined)?.url      // { image: { url } }
    ?? (inner?.["images"] as Array<{ url: string }> | undefined)?.[0]?.url; // fallback array form
  if (!url) {
    console.error("[fal] unexpected response:", JSON.stringify(raw).slice(0, 500));
    throw new Error(`fal.ai InstantID returned no image. Response: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  return url;
}
