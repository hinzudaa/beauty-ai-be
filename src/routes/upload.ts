import { Router, Request, Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { config } from "../config";

const router = Router();

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key:    config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

function uploadToCloudinary(buffer: Buffer, mimetype: string): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "looka/selfies", public_id: randomUUID(), resource_type: "image" },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload failed"));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * POST /upload
 * Body: multipart/form-data, field: "file"
 * Requires auth.
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  // Parse multipart manually using express built-in raw body
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] ?? "";

      // Extract boundary
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (!boundaryMatch) { res.status(400).json({ error: "multipart/form-data шаардлагатай" }); return; }

      const boundary = Buffer.from("--" + boundaryMatch[1]);
      const parts = splitBuffer(body, boundary);
      let fileBuffer: Buffer | null = null;
      let mimetype = "image/jpeg";

      for (const part of parts) {
        const headerEnd = indexOfBuffer(part, Buffer.from("\r\n\r\n"));
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd).toString();
        if (!header.includes("filename=")) continue;
        const ctMatch = header.match(/Content-Type:\s*(\S+)/i);
        if (ctMatch) mimetype = ctMatch[1];
        // File data: skip \r\n\r\n header + trailing \r\n
        fileBuffer = part.slice(headerEnd + 4, part.length - 2);
        break;
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({ error: "file талбар шаардлагатай" }); return;
      }

      const { secure_url, public_id } = await uploadToCloudinary(fileBuffer, mimetype);
      res.json({ url: secure_url, key: public_id });
    } catch (err) {
      console.error("[upload] error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Зураг хуулахад алдаа гарлаа" });
    }
  });
  req.on("error", () => res.status(500).json({ error: "Request error" }));
});

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delimiter, start);
  while (idx !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    idx = buf.indexOf(delimiter, start);
  }
  parts.push(buf.slice(start));
  return parts.filter((p) => p.length > 4);
}

function indexOfBuffer(buf: Buffer, search: Buffer): number {
  for (let i = 0; i <= buf.length - search.length; i++) {
    if (buf.slice(i, i + search.length).equals(search)) return i;
  }
  return -1;
}

export default router;
