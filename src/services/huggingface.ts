import { InferenceClient } from "@huggingface/inference";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import { config } from "../config";

const client = new InferenceClient(config.hf.token);

const MODEL = "black-forest-labs/FLUX.2-klein-9B";

export interface GeneratedLook {
  name:     string;
  imageUrl: string;
}

/** Upload a Buffer to Cloudinary and return secure_url */
async function saveToCloudinary(buffer: Buffer, folder = "looka/looks"): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload failed"));
        resolve(result.secure_url);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Fetch an image from a public URL and return it as a Buffer.
 * Used to get the original selfie for imageToImage.
 */
async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate a transformed look image from the original selfie.
 *
 * @param photoUrl   Cloudinary URL of the original selfie
 * @param prompt     Transformation description sent to FLUX
 * @param lookName   Label for this look (returned in the result)
 */
export async function generateLookImage(
  photoUrl: string,
  prompt:   string,
  lookName: string
): Promise<GeneratedLook> {
  // 1. Fetch original selfie as buffer
  const inputBuffer = await fetchImageBuffer(photoUrl);

  // 2. Run imageToImage via Replicate / FLUX.2
  // inputs must be a Blob — copy to a plain ArrayBuffer first
  const ab = inputBuffer.buffer.slice(
    inputBuffer.byteOffset,
    inputBuffer.byteOffset + inputBuffer.byteLength
  ) as ArrayBuffer;
  const inputBlob = new Blob([ab]);
  const blob = await client.imageToImage({
    provider:   "replicate",
    model:      MODEL,
    inputs:     inputBlob,
    parameters: { prompt },
  });

  // 3. Convert Blob → Buffer
  const outputBuffer = Buffer.from(await blob.arrayBuffer());

  // 4. Save generated image to Cloudinary, get CDN URL
  const imageUrl = await saveToCloudinary(outputBuffer);

  return { name: lookName, imageUrl };
}

/**
 * Generate multiple looks in parallel (capped at 3 concurrent requests).
 */
export async function generateLooks(
  photoUrl: string,
  items: Array<{ name: string; prompt: string }>
): Promise<GeneratedLook[]> {
  // Process in chunks of 3 to avoid hammering the API
  const results: GeneratedLook[] = [];
  const CHUNK = 3;

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const batch = await Promise.all(
      chunk.map((item) => generateLookImage(photoUrl, item.prompt, item.name))
    );
    results.push(...batch);
  }

  return results;
}
