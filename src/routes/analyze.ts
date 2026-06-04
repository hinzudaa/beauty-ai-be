import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import { config } from "../config";
import { requireAuth, requireAccess } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/* ── Looksmaxxing analysis prompt ─────────────────────────────────
   GPT-4o Vision reads the uploaded selfie and returns a structured
   looksmaxxing report — face shape, feature breakdown, score,
   strengths, improvement tips, and style recommendations.
─────────────────────────────────────────────────────────────────── */
const LOOKSMAX_PROMPT = `Та мэргэжлийн looksmaxxing AI юм. Энэ хүний нүүрийг шинжлээд зөвхөн дараах JSON форматаар хариул.
Нэмэлт тайлбар, markdown оруулахгүй — зөвхөн JSON объект.

{
  "faceShape": "Нүүрний хэлбэр монгол хэлээр (Зууван / Дугуй / Дөрвөлжин / Зүрх / Алмаз / Урт)",
  "lookmaxScore": 7.2,
  "features": {
    "eyes": "Нүдний хэлбэр, байршлын дүгнэлт",
    "jawline": "Эрүүний хүч, тодорхойлолт",
    "chin": "Эрүүний доор хэсгийн тэнцвэр",
    "nose": "Хамрын пропорц, хэлбэр",
    "lips": "Уруулын дүүрэн байдал, хэлбэр"
  },
  "skinTone": "Арьсны тон",
  "strengths": ["3–4 хамгийн давуу тал"],
  "improvements": [
    "3–4 лooksmaxxing зөвлөмж — жишээ нь: mewing, skincare routine, хирурги биш аргаар сайжруулах"
  ],
  "hairRecommendations": ["Нүүрний хэлбэрт тохирсон 3 үс засалт монгол+англи хэлээр"],
  "outfitStyle": "Физиологид тохирсон хувцасны ерөнхий зөвлөмж",
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]
}

lookmaxScore: 1–10 оноо, нийт нүүрний хамгийн сайн дүн.
improvements: практик, хирурги биш, монгол хэлээр.`;

/* ── Save a URL-based image to Cloudinary ─────────────────────────
   DALL-E 3 returns temporary URLs — we save them permanently to CDN.
─────────────────────────────────────────────────────────────────── */
async function saveUrlToCloudinary(imageUrl: string, folder = "looka/looks"): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      imageUrl,
      { folder, resource_type: "image" },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload failed"));
        resolve(result.secure_url);
      }
    );
  });
}

/* ── POST /analyze/full ───────────────────────────────────────────
   1. GPT-4o Vision → full looksmaxxing analysis report (~5s)
   2. Subscription usage incremented
─────────────────────────────────────────────────────────────────── */
router.post("/full", requireAuth, requireAccess, async (req: Request, res: Response) => {
  const { url, event = "casual" } = req.body as { url?: string; event?: string };

  if (!url) {
    res.status(400).json({ error: "url шаардлагатай (Cloudinary CDN URL)" });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url, detail: "high" } },
          { type: "text", text: LOOKSMAX_PROMPT },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    const content = completion.choices[0].message.content;
    if (!content) { res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" }); return; }

    const analysis = JSON.parse(content);

    // Count one subscription use
    const user = await User.findById(req.userId);
    if (user) {
      await User.findByIdAndUpdate(req.userId, { $inc: { "subscription.monthlyUsage": 1 } });
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "full" }).catch(() => {});
    }

    res.json({ analysis, occasion: event });
  } catch (err) {
    console.error("[analyze/full] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Шинжилгээ хийхэд алдаа гарлаа" });
  }
});

/* ── POST /analyze/generate-looks ────────────────────────────────
   DALL-E 3 generates look inspiration images based on the analysis.
   Called right after /full — images load progressively in the UI.

   Body: {
     photoUrl: string,              — original selfie (used in prompt context)
     items: Array<{ name, prompt }> — up to 6 looks
   }
─────────────────────────────────────────────────────────────────── */
router.post("/generate-looks", requireAuth, async (req: Request, res: Response) => {
  const { items } = req.body as {
    items?: Array<{ name: string; prompt: string }>;
  };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items шаардлагатай" });
    return;
  }

  try {
    // Generate all images in parallel (DALL-E 3 handles up to 5 concurrent requests)
    const looks = await Promise.all(
      items.slice(0, 6).map(async (item) => {
        const response = await openai.images.generate({
          model:   "dall-e-3",
          prompt:  item.prompt,
          n:       1,
          size:    "1024x1024",
          quality: "standard",
        });

        const tempUrl = response.data?.[0]?.url;
        if (!tempUrl) throw new Error("DALL-E returned no image URL");
        const tempUrlStr = tempUrl;

        // Save to Cloudinary so the URL doesn't expire
        const permanentUrl = await saveUrlToCloudinary(tempUrlStr);

        return { name: item.name, imageUrl: permanentUrl };
      })
    );

    res.json({ looks });
  } catch (err) {
    console.error("[analyze/generate-looks] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Look зураг үүсгэхэд алдаа гарлаа" });
  }
});

export default router;
