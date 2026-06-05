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
  '  "gender": "Зургаас харж тодорхойлсон хүйс: male эсвэл female",',
  '  "faceShape": "Нүүрний хэлбэрийг зургаас шууд шинжлэн тайлбарла — урьдчилан тодорхойлсон ангилалгүйгээр. Нүүрний өргөн/урт харьцаа, эрүүний шугам, хацрын өндрийг харьцуулж яггүй тодорхойлол. Жишээ: уртавтар нарийхан нүүр, доошоо нарийссан зүрх хэлбэртэй, дугуйвтар дэлгэр нүүр гэх мэт.",',
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
  '  "skinTone": "Зургаас ШУУД уншсан арьсны бодит өнгө — Fitzpatrick scale (I–VI) болон тодорхой тайлбар. Жишээ: Fitzpatrick II, цайвар-дулаан зааглалтай, нүүрний хацар болон хүзүүний өнгийг харьцуулж тодорхойл",',
  '  "undertone": "Зургаас ШУУД уншсан undertone — судсыг (хөх=cool, ногоон=warm), мөн нүүрний сүүдрийн өнгийг харж тодорхойл (Warm / Cool / Neutral)",',
  '  "seasonalColor": "skinTone болон undertone-д үндэслэсэн seasonal color (Spring / Summer / Autumn / Winter) — хамгийн тохирох өнгийн улирал",',
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
  '  "hairRecommendations": [',
  '    "GENDER-ийг эхлээд тодорхойл.",',
  '    "",',
  '    "Хэрэв male бол зөвхөн эрэгтэй Korean hairstyle-аас сонго:",',
  '    "Two Block Cut, Comma Hair, Shadow Perm, Down Perm, Leaf Cut, Ivy League Korean, Textured Crop Korean, Dandy Cut",',
  '    "",',
  '    "Хэрэв female бол зөвхөн эмэгтэй Korean hairstyle-аас сонго:",',
  '    "Hush Cut, Korean Layered Cut, Air Bangs, See-through Bangs, Korean Bob, Long Wave Perm, C-Curl Perm, S-Curl Layered Hair",',
  '    "",',
  '    "Нүүрний хэлбэр, эрүү, хацрын бүтэцтэй хамгийн зохицох 3 үс засалтыг эрэмбэлэн буцаа.",',
  '    "Зөвхөн Korean/K-Drama/K-Pop стиль ашигла.",',
  '    "Үс засалт бүрийн яагаад тохирохыг 1 өгүүлбэрээр тайлбарла.",',
  '    "Формат: { \\"name\\": \\"...\\" , \\"reason\\": \\"...\\" }"',
  '  ],',
  '  "outfitStyle": {',
  '    "season": "seasonalColor дээр үндэслэсэн улирлын төрөл",',
  '    "bestColors": ["хамгийн зохих 5 хувцасны өнгө — skinTone+undertone+seasonalColor ашиглан сонго"],',
  '    "avoidColors": ["арьсны өнгийг бүдгэрүүлэх 3-5 өнгө"],',
  '    "koreanStyle": {',
  '      "styleName": "хамгийн тохирох Korean fashion style (Old Money Korean / Clean Fit Korean / Quiet Luxury Korean / K-Drama Smart Casual / K-Pop Street Fashion)",',
  '      "description": "яагаад тохирохыг тайлбарла",',
  '      "tops": ["дээд хувцасны 2 санал"],',
  '      "bottoms": ["доод хувцасны 2 санал"],',
  '      "outerwear": ["гадуур хувцасны 2 санал"]',
  '    }',
  '  },',
  '  "OUTFIT_RULE": "Warm undertone→cream,camel,olive,beige,chocolate,warm navy | Cool→charcoal,pure white,icy blue,emerald,cool grey | Neutral→muted navy,taupe,soft white,dusty blue. Хэзээ ч ерөнхий өнгө бүү санал болго.",',
  '  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]',
  "  // colorPalette: зургаас шууд харж тодорхойлсон ЯГГҮЙ 5 өнгө —",
  "  // 1-р өнгө: арьсны бодит hex өнгө (зургаас пиксел унших),",
  "  // 2-3-р өнгө: арьсны undertone-д хамгийн зохирох хувцасны өнгө,",
  "  // 4-5-р өнгө: нэмэлт аксессуар болон нийлдэг өнгө.",
  "  // Зургийг анхааралтай харж ЯГГҮЙ hex кодуудыг гарга — ойролцоо биш.",
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
      model: "gpt-4o-mini",
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

    // Save analysis to DB — monthlyUsage increments only after generate-looks completes
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
      gender?:             string;
      faceShape:           string;
      skinTone:            string;
      hairRecommendations: Array<{ name: string; reason: string } | string>;
      outfitStyle:         { season?: string; bestColors?: string[]; koreanStyle?: { styleName?: string; description?: string; tops?: string[]; bottoms?: string[]; outerwear?: string[] } } | string;
      colorPalette?:       string[];
    };
    occasion?: string;
  };

  if (!imageUrl || !analysis?.faceShape) {
    res.status(400).json({ error: "imageUrl болон analysis шаардлагатай" });
    return;
  }

  const { gender = "female", faceShape, hairRecommendations = [], outfitStyle } = analysis;

  const isMale    = gender?.toLowerCase() === "male";
  const personStr = isMale ? "young man" : "young woman";

  // Normalise hairRecommendations → always array of strings
  const hairNames: string[] = hairRecommendations.map((h) =>
    typeof h === "string" ? h : h.name
  );

  // Normalise outfitStyle → extract readable string for prompt
  let outfitDesc = "";
  if (typeof outfitStyle === "string") {
    outfitDesc = outfitStyle;
  } else if (outfitStyle) {
    const ks = outfitStyle.koreanStyle;
    const colors = outfitStyle.bestColors?.join(", ") ?? "";
    outfitDesc = [
      ks?.styleName,
      ks?.description,
      colors ? `Best colors: ${colors}` : "",
      ks?.tops?.join(", "),
      ks?.bottoms?.join(", "),
    ].filter(Boolean).join(". ");
  }

  // Check user's plan
  const user = await User.findById(req.userId);
  const plan = user?.subscription?.plan ?? "basic";
  const isPro = plan === "pro";
  // Basic/Standard: 1 hair + 1 outfit = 2 images
  // Pro:            2 hair + 2 outfit = 4 images

  const items: { name: string; prompt: string }[] = [];

  // IMAGE 1 — Hairstyle
  const topHair = hairNames[0];
  if (topHair) {
    items.push({
      name: topHair,
      prompt: `The same ${personStr} from the input photo with a Korean ${topHair} hairstyle. K-drama style hair, perfectly styled. Close-up portrait focused on the face and hair. Same face, same skin, same features — only the hairstyle changes. Golden hour warm light hitting one side of the face, soft bokeh background, natural skin texture, sharp eyes, cinematic color grade with warm tones. Professional 85mm lens, f/1.4 shallow depth of field, ultra realistic, photorealistic, 8K resolution, masterpiece portrait photography.`,
    });
  }

  // Outfit aesthetic from AI analysis
  const outfitAesthetic = outfitDesc || "Korean clean fit, modern premium fashion, elevated contemporary style";

  // IMAGE 2 — Outfit
  if (outfitDesc || outfitStyle) {
    items.push({
      name: "Outfit Look",
      prompt: `The same ${personStr} from the input photo wearing a ${outfitAesthetic} outfit for ${occasion}. Only the clothing changes — same face, same features. Athletic symmetrical body, confident posture. Natural soft daylight, cinematic color grade, fashion editorial style, realistic skin texture, shallow depth of field. Full body shot, centered composition, 85mm lens f/2.0, ultra photorealistic, professional fashion shoot, 8K, masterpiece.`,
    });
  }

  // Pro image 3: second hair variation
  if (isPro && hairNames[1]) {
    items.push({
      name: hairNames[1],
      prompt: `The same ${personStr} from the input photo with a Korean ${hairNames[1]} hairstyle. K-drama style hair, perfectly styled. Close-up portrait focused on face and hair. Same face, same skin — only the hairstyle changes. Soft studio lighting, natural skin texture, sharp eyes, cinematic color grade, shallow depth of field. Ultra realistic, photorealistic, 8K, masterpiece portrait photography.`,
    });
  }

  // Pro image 4: second outfit variation
  if (isPro && (outfitDesc || outfitStyle)) {
    items.push({
      name: "Outfit Look 2",
      prompt: `The same ${personStr} from the input photo wearing an alternative ${outfitAesthetic} look for ${occasion} with a different silhouette. Only clothing changes. Athletic symmetrical body. Natural soft daylight, cinematic color grade, full body shot, 85mm lens f/2.0, ultra photorealistic, 8K, masterpiece fashion editorial.`,
    });
  }
  // Pro total: 4 images (2 hair + 2 outfit)

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

    // Increment monthlyUsage only after looks are successfully generated
    if (user) {
      await User.findByIdAndUpdate(req.userId, { $inc: { "subscription.monthlyUsage": 1 } });
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "full" }).catch(() => {});
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
