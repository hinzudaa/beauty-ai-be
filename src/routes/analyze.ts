import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { requireAuth, requireAccess } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/* ── GPT-4o looksmaxxing prompt ────────────────────────────────── */
const LOOKSMAX_PROMPT = `Та мэргэжлийн looksmaxxing AI юм. Энэ хүний нүүрийг шинжлээд зөвхөн дараах JSON форматаар хариул.
Нэмэлт тайлбар, markdown оруулахгүй — зөвхөн JSON объект.

{
  "faceShape": "Нүүрний хэлбэр (Зууван / Дугуй / Дөрвөлжин / Зүрх / Алмаз / Урт)",
  "lookmaxScore": 7.2,
  "features": {
    "eyes":    "Нүдний хэлбэр, байршлын дүгнэлт",
    "jawline": "Эрүүний хүч, тодорхойлолт",
    "chin":    "Эрүүний доор хэсгийн тэнцвэр",
    "nose":    "Хамрын пропорц, хэлбэр",
    "lips":    "Уруулын дүүрэн байдал, хэлбэр"
  },
  "skinTone": "Арьсны тон (жишээ: Дулаан дунд, Хүйтэн цайвар)",
  "strengths":           ["3–4 хамгийн давуу тал монгол хэлээр"],
  "improvements":        ["3–4 looksmaxxing зөвлөмж монгол хэлээр — хирурги биш аргаар"],
  "hairRecommendations": ["Нүүрний хэлбэрт тохирсон 3 үс засалт нэр"],
  "outfitStyle":         "Физиологид тохирсон хувцасны ерөнхий зөвлөмж монгол хэлээр",
  "colorPalette":        ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]
}

lookmaxScore: 1–10. improvements: практик, хирурги биш, монгол хэлээр.`;

/* ── Save DALL-E URL to Cloudinary (DALL-E URLs expire in ~1hr) ── */
async function saveToCDN(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      imageUrl,
      { folder: "looka/looks", resource_type: "image" },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("CDN upload failed"));
        resolve(result.secure_url);
      }
    );
  });
}

/* ══ POST /analyze/full ══════════════════════════════════════════
   GPT-4o Vision → looksmaxxing analysis report
══════════════════════════════════════════════════════════════════ */
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
          { type: "text",      text: LOOKSMAX_PROMPT },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    const content = completion.choices[0].message.content;
    if (!content) { res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" }); return; }

    const analysis = JSON.parse(content);

    const user = await User.findById(req.userId);
    if (user) {
      await User.findByIdAndUpdate(req.userId, { $inc: { "subscription.monthlyUsage": 1 } });
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "full" }).catch(() => {});
    }

    res.json({ analysis, occasion: event });
  } catch (err) {
    console.error("[analyze/full]", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Шинжилгээ хийхэд алдаа гарлаа" });
  }
});

/* ══ POST /analyze/generate-looks (FACE-PRESERVING) ═════════════
   gpt-image-1 image editing — хэрэглэгчийн SELFIE-г input болгон авч
   зөвхөн үс / хувцас өөрчилнө. Нүүр 100% хадгалагдана.

   Body: {
     imageUrl: string,            — original Cloudinary selfie URL
     analysis: { faceShape, skinTone, hairRecommendations, outfitStyle },
     occasion: string
   }
══════════════════════════════════════════════════════════════════ */
router.post("/generate-looks", requireAuth, async (req: Request, res: Response) => {
  const { imageUrl, analysis, occasion = "casual" } = req.body as {
    imageUrl?: string;
    analysis?: {
      faceShape:           string;
      skinTone:            string;
      hairRecommendations: string[];
      outfitStyle:         string;
    };
    occasion?: string;
  };

  if (!imageUrl || !analysis?.faceShape) {
    res.status(400).json({ error: "imageUrl болон analysis шаардлагатай" });
    return;
  }

  const { faceShape, skinTone, hairRecommendations = [], outfitStyle = "" } = analysis;

  const items: { name: string; prompt: string }[] = [];

  // Hairstyle edits — нүүр яг хэвээр, зөвхөн үс өөрчлөгдөнө
  for (const style of hairRecommendations.slice(0, 3)) {
    items.push({
      name: style,
      prompt: `
Keep the exact same person, face, identity, and facial structure from the input image.
Only change the hairstyle to: ${style}.
Maintain: same jawline, same eyes, same nose, same lips, same skin tone (${skinTone}).
Style: professional fashion portrait, studio lighting, ultra realistic, 4K.
      `.trim(),
    });
  }

  // Outfit edit — нүүр яг хэвээр, зөвхөн хувцас өөрчлөгдөнө
  if (outfitStyle) {
    items.push({
      name: "Style Look",
      prompt: `
Keep the exact same person and face identity from the input image.
Only change the clothing to: ${outfitStyle}, suitable for ${occasion}.
Do NOT change: face shape (${faceShape}), facial features, or body proportions.
Style: full body fashion photography, studio lighting, realistic, high-end editorial.
      `.trim(),
    });
  }

  try {
    // Fetch original selfie as Blob for the image editing API
    const selfieBlob = await fetch(imageUrl).then((r) => r.blob());

    const looks = await Promise.all(
      items.map(async (item) => {
        const response = await openai.images.edit({
          model:  "gpt-image-1",          // identity-preserving image model
          image:  selfieBlob as File,      // original selfie input
          prompt: item.prompt,
          size:   "1024x1024",
        });

        const tempUrl = response.data?.[0]?.url;
        if (!tempUrl) throw new Error("gpt-image-1 returned no URL");

        // Persist to Cloudinary (URLs may expire)
        const permanentUrl = await saveToCDN(tempUrl);
        return { name: item.name, imageUrl: permanentUrl };
      })
    );

    res.json({ looks });
  } catch (err) {
    console.error("[analyze/generate-looks]", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Look зураг үүсгэхэд алдаа гарлаа" });
  }
});

export default router;
