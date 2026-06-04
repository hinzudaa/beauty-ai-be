import { fal } from "@fal-ai/client";
import { config } from "../config";

fal.config({ credentials: config.fal.key });

interface FalImage {
  url:    string;
  width:  number;
  height: number;
}

interface FalResult {
  images?: FalImage[];
}

/**
 * Generate a face-preserving look using fal.ai InstantID.
 *
 * InstantID uses the reference face image to ensure the same person
 * appears in every generated image — only hair or outfit changes.
 *
 * @param faceImageUrl  Cloudinary URL of the original selfie (reference face)
 * @param prompt        What to change (hairstyle / outfit description)
 * @returns             URL of the generated image
 */
export async function generateWithInstantID(
  faceImageUrl: string,
  prompt:       string
): Promise<string> {
  const result = await fal.subscribe("fal-ai/instantid", {
    input: {
      face_image_url:                faceImageUrl,
      prompt,
      negative_prompt:               "deformed, ugly, blurry, low quality, bad anatomy, extra limbs, mutation, disfigured",
      num_inference_steps:           30,
      guidance_scale:                5,
      controlnet_conditioning_scale: 0.8,
      ip_adapter_scale:              0.8,
      image_size:                    "square_hd",   // 1024×1024
    },
  }) as { data: FalResult };

  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai InstantID returned no image");
  return url;
}
