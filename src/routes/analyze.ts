import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { generateWithInstantID } from "../services/fal";
import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { requireAuth, requireAccess, requirePro } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";
import { Analysis } from "../models/analysis";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/* ── GPT-4o analysis prompt ─────────────────────────────────────
   Fair 1–10 bell-curve scoring. Average person = 5.0.
   No surgery suggestions. Warm but honest tone.
───────────────────────────────────────────────────────────────── */
const LOOKSMAX_PROMPT = [
  "Та мэргэжлийн гоо сайхны шинжилгээний AI юм.",
  "Энэ хүний нүүрийг объектив, шударга байдлаар шинжлээд зөвхөн доорх JSON форматаар хариул.",
  "Нэмэлт тайлбар, markdown огт оруулахгүй — зөвхөн JSON объект.",
  "",
  "ОНОО ТООЦООЛОХ ЗААВАР (заавал дагах):",
  "  - Хүн амын дундаж оноо = 5.0",
  "  - 1–4: дундаас доош   (30% хүн)",
  "  - 4–6: дундаж          (40% хүн)",
  "  - 6–8: дундаас дээш   (25% хүн)",
  "  - 8–10: маш сайн/ховор (5% хүн)",
  "  - 9+ оноо: загвар өмсөгч, тэмцээний оролцогч зэрэг — маш ховор",
  "  - Оноо 0.5-ын нарийвчлалтай байна (жишээ: 5.5, 6.0, 7.5)",
  "  - Нүүрний тэгш хэм, пропорц, арьс, нас бүгдийг харгалз",
  "",
  "{",
  '  "faceShape": "Нүүрний хэлбэр (Зууван / Дугуй / Дөрвөлжин / Зүрх / Алмаз / Урт)",',
  '  "lookmaxScore": 5.5,',
  '  "features": {',
  '    "eyes":    "Нүдний хэлбэр, тэгш хэм — тайван дүгнэлт",',
  '    "jawline": "Эрүүний тодорхой байдал, хэлбэр",',
  '    "chin":    "Эрүүний доод хэсэг, тэнцвэр",',
  '    "nose":    "Хамрын пропорц, нүүртэй нийцэх байдал",',
  '    "lips":    "Уруулын хэлбэр, дүүрэн байдал"',
  "  },",
  '  "skinTone": "Арьсны тон (жишээ: Дулаан алт, Хүйтэн цайвар, Нейтрал дунд)",',
  '  "strengths": ["3 бодит давуу тал — шударга, хэтэрхий биш"],',
  '  "improvements": ["3–4 өдөр тутмын практик зөвлөмж: skincare, үс засалт, хувцаслалт — хирурги огт биш"],',
  '  "hairRecommendations": ["Нүүрний хэлбэрт тохирсон 3 үс засалтын нэр"],',
  '  "outfitStyle": "Биеийн онцлог, арьсны тонд нийцсэн хувцасны зөвлөмж",',
  '  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]',
  "}",
].join("\n");

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

    // Save analysis to DB so user can view it again from profile
    const saved = await Analysis.create({
      userId:   req.userId,
      photoUrl: url,
      analysis,
      looks:    [],
      occasion: event,
    });

    res.json({ analysis, occasion: event, analysisId: String(saved._id) });
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
router.post("/generate-looks", requireAuth, requireAccess, async (req: Request, res: Response) => {
  const { imageUrl, analysisId, analysis, occasion = "casual" } = req.body as {
    imageUrl?:   string;
    analysisId?: string;
    analysis?: {
      faceShape:           string;
      skinTone:            string;
      hairRecommendations: string[];
      outfitStyle:         string;
      colorPalette?:       string[];
    };
    occasion?: string;
  };

  if (!imageUrl || !analysis?.faceShape) {
    res.status(400).json({ error: "imageUrl болон analysis шаардлагатай" });
    return;
  }

  const {
    faceShape,
    skinTone,
    hairRecommendations = [],
    outfitStyle = "",
    colorPalette = [],
    features = {} as Record<string, string>,
  } = analysis as typeof analysis & { features?: Record<string, string> };

  const paletteStr  = colorPalette.slice(0, 3).join(", ") || skinTone;

  // Check user's plan to decide how many looks to generate
  const user = await User.findById(req.userId);
  const isPro = user?.subscription?.plan === "pro";

  // Basic: 1 hair + 1 outfit = 2 images
  // Pro:   2 hair + 2 outfit + 1 bonus = 5 images
  const hairCount   = isPro ? 2 : 1;
  const outfitCount = isPro ? 2 : 1;

  const items: { name: string; prompt: string }[] = [];

  // Hair looks
  for (const style of hairRecommendations.slice(0, hairCount)) {
    items.push({
      name: style,
      prompt: `${style} hairstyle, ${skinTone} skin, ${faceShape} face shape, beauty portrait, studio lighting, photorealistic, high quality`,
    });
  }

  // Outfit looks
  if (outfitStyle) {
    items.push({
      name: "Outfit Look",
      prompt: `${outfitStyle} outfit, colors ${paletteStr}, suitable for ${occasion}, ${skinTone} skin, full body fashion photography, studio lighting, photorealistic, high quality`,
    });
    if (isPro) {
      items.push({
        name: "Outfit Look 2",
        prompt: `alternative ${outfitStyle} outfit, different color variation from ${paletteStr}, suitable for ${occasion}, ${skinTone} skin, full body fashion photography, natural lighting, photorealistic, high quality`,
      });
    }
  }

  // Pro bonus: casual everyday look
  if (isPro) {
    items.push({
      name: "Casual Look",
      prompt: `casual everyday outfit using colors ${paletteStr}, complementing ${skinTone} skin tone, comfortable modern style, ${skinTone} skin, full body fashion photography, natural lighting, photorealistic, high quality`,
    });
  }

  try {
    // Run sequentially — fal.ai handles concurrency internally
    const looks: Array<{ name: string; imageUrl: string }> = [];

    for (const item of items) {
      // fal.ai InstantID: takes the Cloudinary selfie URL as face reference
      // → generates the SAME person with only hair/outfit changed
      const falUrl = await generateWithInstantID(imageUrl, item.prompt);

      // Save to Cloudinary for permanence (fal.ai URLs may expire)
      const permanentUrl = await saveToCDN(falUrl);
      looks.push({ name: item.name, imageUrl: permanentUrl });
    }

    if (analysisId) {
      Analysis.findByIdAndUpdate(analysisId, { looks }).catch(() => {});
    }

    res.json({ looks });
  } catch (err) {
    // Log the full error so we can debug
    console.error("[analyze/generate-looks] FULL ERROR:", err);
    res.status(500).json({
      error: "Look зураг үүсгэхэд алдаа гарлаа",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

/* ── GET /analyze/result/:id — public, no auth ───────────────────
   Used by the shareable results page to fetch analysis data.
   Facebook/OG crawler calls this too.
─────────────────────────────────────────────────────────────────── */
router.get("/result/:id", async (req: Request, res: Response) => {
  try {
    const doc = await Analysis.findById(req.params.id).lean();
    if (!doc) { res.status(404).json({ error: "Analysis not found" }); return; }
    res.json({
      id:        doc._id,
      photoUrl:  doc.photoUrl,
      analysis:  doc.analysis,
      looks:     doc.looks,
      occasion:  doc.occasion,
      createdAt: doc.createdAt,
    });
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

export default router;
