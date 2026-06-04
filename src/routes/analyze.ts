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
  "Та мэргэжлийн гоо сайхны дүн шинжилгээний AI юм — загвар өмсөгчдийг бэлддэг мэргэжилтний түвшинд.",
  "Энэ хүний нүүрийг маш нарийн шинжлээд зөвхөн доорх JSON форматаар хариул.",
  "Нэмэлт тайлбар, markdown огт оруулахгүй — зөвхөн JSON объект.",
  "",
  "ЗОРИЛГО: Хүмүүс өөрийнхөө тухай мэддэггүй нуугдмал онцлогуудыг илрүүлж, тэдэнд шинэ зүйл нээж өгөх.",
  "Жирийн тайлбар биш — тодорхой, гайхалтай, практик мэдрэмж өгөх.",
  "",
  "ОНОО ТООЦООЛОХ ЗААВАР (заавал дагах):",
  "  - Хүн амын дундаж = 5.0",
  "  - 1–4: дундаас доош (30%), 4–6: дундаж (40%), 6–8: дэвшилтэт (25%), 8–10: ховор (5%)",
  "  - Оноо 0.5 нарийвчлалтай. Нүүрний тэгш хэм, алтан пропорц, арьс, нас харгалз.",
  "",
  "{",
  '  "faceShape": "Нүүрний хэлбэр (Зууван / Дугуй / Дөрвөлжин / Зүрх / Алмаз / Урт)",',
  '  "lookmaxScore": 5.5,',
  "",
  '  "features": {',
  '    "eyes":    "Нүдний хэлбэр, өнгө, тэгш хэм — хүмүүс өөрсдөө анзаардаггүй онцлог (жишээ: hooded eyelid, heterochromia, limbal ring гэх мэт)",',
  '    "jawline": "Эрүүний тод байдал, хэлбэр — нүүрний нийт impression-д хэрхэн нөлөөлж байгааг тайлбарла",',
  '    "chin":    "Эрүүний доод хэсгийн тэнцвэр — profile дээр хэрхэн харагддаг",',
  '    "nose":    "Хамрын пропорц, bridge, tip — нүүрийн гол тэнхлэгт үзүүлэх нөлөө",',
  '    "lips":    "Уруулын Cupid\'s bow, philtrum, дүүрэн байдал — эрчим, илэрхийлэл"',
  "  },",
  "",
  '  "skinTone": "Арьсны тон (жишээ: Дулаан алт, Хүйтэн цайвар, Нейтрал олива)",',
  '  "undertone": "Арьсны далд дулаан/хүйтэн тон (Warm / Cool / Neutral) — ихэнх хүн мэддэггүй өөрийнхөө undertone",',
  '  "seasonalColor": "Өнгөний улирал (Spring / Summer / Autumn / Winter) — ямар өнгийн хувцас хамгийн их гэрэлтүүлдэг",',
  "",
  '  "hiddenStrengths": [',
  '    "Хүмүүс өөрсдөө анзаардаггүй гэхдээ бусад нь анзаардаг 2–3 онцлог тал — маш тодорхой, лавтай"',
  "  ],",
  '  "strengths": ["3 тод давуу тал — шударга, хэтэрхий биш"],',
  '  "improvements": [',
  '    "3–4 практик зөвлөмж: skincare routine, үс засалтын нарийн зөвлөгөө, нүүрний хэлбэрт тохирсон нүүр будалтын арга, хирурги огт биш"',
  "  ],",
  "",
  '  "makeupTips": "Энэ хүний нүүрний хэлбэр, онцлогт тохирсон 1–2 нүүр будалтын конкрет зөвлөгөө (жишээ: contour хаана хэрэглэх, ямар lip color тохирох)",',
  '  "hairRecommendations": ["Нүүрний хэлбэрт тохирсон 3 үс засалтын нэр"],',
  '  "outfitStyle": "Undertone болон seasonal color-д үндэслэсэн хувцасны зөвлөмж — ямар өнгийн хослол хамгийн их гэрэлтүүлэх",',
  '  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]',
  "}",
  "",
  "hiddenStrengths: хүмүүст шинэ зүйл нээж өгөх — 'Таны нүд ийм онцлогтой' гэх мэт мэдрэмжтэй байх.",
  "makeupTips: ерөнхий биш, энэ хүний нүүрт ЗОРИУЛСАН тодорхой зөвлөгөө.",
  "undertone + seasonalColor: хэрэглэгчид ихэвчлэн мэддэггүй боловч стайлдаа маш чухал.",
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
    hairRecommendations = [],
    outfitStyle = "",
  } = analysis;

  // Check user's plan to decide how many looks to generate
  const user = await User.findById(req.userId);
  const plan = user?.subscription?.plan ?? "basic";

  // Basic:    1 hair + 1 outfit = 2 images
  // Standard: 1 hair + 2 outfit = 3 images
  // Pro:      2 hair + 2 outfit + 1 bonus = 5 images
  const hairCount = plan === "pro" ? 2 : 1;
  const isPro     = plan === "pro";

  const items: { name: string; prompt: string }[] = [];

  // ── Hair looks — NO color palette, NO skin tone in prompt ──
  // InstantID already reads skin tone from the input image.
  // Prompt only describes the TARGET hairstyle to maximize change.
  for (const style of hairRecommendations.slice(0, hairCount)) {
    items.push({
      name: style,
      prompt: `A person with ${style} hairstyle. The hair is clearly changed to ${style}. ${faceShape} face. Beauty portrait, soft studio lighting, clean background, photorealistic, 4K. Focus on the hairstyle transformation.`,
    });
  }

  // ── Outfit looks — describe clothing only, no color palette numbers ──
  if (outfitStyle) {
    items.push({
      name: "Outfit Look",
      prompt: `Full body fashion photo. Person wearing ${outfitStyle}, appropriate for ${occasion}. Stylish, well-fitted clothing. Clean studio background, professional fashion photography, photorealistic, 4K. Show the full outfit clearly.`,
    });
    if (isPro) {
      items.push({
        name: "Outfit Look 2",
        prompt: `Full body fashion photo. Person wearing a different variation of ${outfitStyle} for ${occasion}. Different silhouette or style. Clean studio background, professional fashion photography, photorealistic, 4K.`,
      });
    }
  }

  // Pro bonus
  if (isPro) {
    items.push({
      name: "Casual Look",
      prompt: `Full body photo. Person wearing a casual everyday modern outfit suitable for ${occasion}. Comfortable and stylish. Clean background, natural lighting, photorealistic, 4K.`,
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
