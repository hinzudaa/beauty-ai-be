import { Router, Request, Response } from "express";
import multer from "multer";
import { Readable } from "stream";
import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";

const router = Router();

// Configure Cloudinary once at startup
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key:    config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

/** In-memory multer — no disk writes, max 10 MB */
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Зөвхөн зургийн файл оруулна уу"));
  },
});

/** Upload a buffer to Cloudinary and return secure_url + public_id */
function uploadToCloudinary(
  buffer: Buffer,
  mimetype: string
): Promise<{ secure_url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:         "looka/selfies",
        resource_type:  "image",
        format:         mimetype.split("/")[1] ?? "jpg",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("No result from Cloudinary"));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * POST /upload
 * Content-Type: multipart/form-data
 * Field: file  (image/jpeg | image/png | image/webp)
 *
 * Uploads selfie to Cloudinary and returns the CDN URL.
 */
router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "file талбар шаардлагатай" });
      return;
    }

    try {
      const { secure_url, public_id } = await uploadToCloudinary(file.buffer, file.mimetype);
      res.json({ url: secure_url, key: public_id });
    } catch (err) {
      console.error("[upload] Cloudinary error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Зураг хуулахад алдаа гарлаа" });
    }
  }
);

export default router;
