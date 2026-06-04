import { Router, Request, Response } from "express";
import OpenAI, { toFile } from "openai";
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
router.post("/generate-looks", requireAuth, requirePro, async (req: Request, res: Response) => {
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

  const { faceShape, skinTone, hairRecommendations = [], outfitStyle = "", colorPalette = [] } = analysis;
  const paletteStr = colorPalette.slice(0, 3).join(", ") || skinTone;

  const items: { name: string; prompt: string }[] = [];

  // 2 hair looks — chosen specifically to flatter the face shape
  for (const style of hairRecommendations.slice(0, 2)) {
    items.push({
      name: style,
      prompt: `Transform this exact person's hairstyle to "${style}", which is specifically recommended for a ${faceShape} face shape because it perfectly frames and enhances their facial features. The new hairstyle must make this person look more attractive and beautiful by complementing their ${faceShape} face proportions. Keep every facial feature absolutely identical: same eyes, nose, lips, jawline, skin tone (${skinTone}), and face structure. Result should look like a professional beauty editorial photo with perfect studio lighting, ultra realistic, 4K.`,
    });
  }

  // 2 outfit looks — colors from personal palette to match skin tone
  if (outfitStyle) {
    items.push({
      name: "Outfit Look 1",
      prompt: `Dress this exact person in a stylish ${outfitStyle} outfit for ${occasion}, using colors from their personal color palette: ${paletteStr}. These colors are chosen because they harmonize beautifully with their ${skinTone} skin tone, making them look radiant and put-together. Keep every facial feature exactly the same. Full body fashion photography, studio lighting, high-end editorial, ultra realistic.`,
    });
    items.push({
      name: "Outfit Look 2",
      prompt: `Dress this exact person in an alternative ${outfitStyle} ensemble for ${occasion}, using a different combination of their personal colors: ${paletteStr}. Pick a different silhouette or layering but keep the same color harmony with their ${skinTone} skin tone. Keep every facial feature exactly the same. Full body fashion photography, natural soft lighting, modern editorial, ultra realistic.`,
    });
  }

  try {
    // Fetch the selfie and convert to a proper File object for OpenAI
    const selfieArrayBuffer = await fetch(imageUrl).then((r) => r.arrayBuffer());
    const selfieBuffer = Buffer.from(new Uint8Array(selfieArrayBuffer));
    const selfieFile = await toFile(selfieBuffer, "selfie.png", { type: "image/png" });

    const looks = await Promise.all(
      items.map(async (item) => {
        const response = await openai.images.edit({
          model:  "gpt-image-1",
          image:  selfieFile,
          prompt: item.prompt,
          size:   "1024x1024",
          // Note: gpt-image-1 does NOT support response_format param
          // It returns b64_json by default
        });

        // Handle both URL and base64 response formats
        const resp = response as { data?: Array<{ url?: string; b64_json?: string }> };
        const imageData = resp.data?.[0];
        let permanentUrl: string;

        if (imageData?.url) {
          permanentUrl = await saveToCDN(imageData.url);
        } else if (imageData?.b64_json) {
          // Upload base64 directly to Cloudinary
          permanentUrl = await new Promise<string>((resolve, reject) => {
            cloudinary.uploader.upload(
              `data:image/png;base64,${imageData.b64_json}`,
              { folder: "looka/looks", resource_type: "image" },
              (err, result) => {
                if (err || !result) return reject(err ?? new Error("CDN upload failed"));
                resolve(result.secure_url);
              }
            );
          });
        } else {
          throw new Error("gpt-image-1 returned no image data");
        }

        return { name: item.name, imageUrl: permanentUrl };
      })
    );

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
