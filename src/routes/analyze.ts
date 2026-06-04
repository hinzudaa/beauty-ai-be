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
  '    "Энэ хүний нүүрний хэлбэр, хацрын шугам, нүдний байрлал, эрүүний тэнцвэрийг харгалзан хамгийн хөөрхөн, царайлаг, гоёмсог харагдуулах 3 үс засалтын НЭР — загвар журналын cover photo-д тохирох чанартай. Зөвхөн үс засалтын нэрийг монгол болон англи хэлний хосолсон богино нэрээр бич.",',
  '  ],',
  '  "outfitStyle": "Undertone болон seasonal color-д үндэслэсэн хувцасны зөвлөмж — ямар өнгийн хослол хамгийн их гэрэлтүүлэх",',
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
    gender = "female",
    faceShape,
    hairRecommendations = [],
    outfitStyle = "",
  } = analysis;

  const isMale    = gender?.toLowerCase() === "male";
  const personStr = isMale ? "young man" : "young woman";

  // Check user's plan
  const user = await User.findById(req.userId);
  const plan = user?.subscription?.plan ?? "basic";
  const isPro = plan === "pro";

  // ── STRICT RULES FOR ALL PROMPTS ──────────────────────────────
  // ✗ NEVER mention colorPalette, hex codes, or skin tone — these cause color leaking
  // ✓ ONLY describe what to CHANGE: hairstyle OR outfit
  // ✓ InstantID reads the face/skin directly from the input image — do not override it
  // ─────────────────────────────────────────────────────────────
  const items: { name: string; prompt: string }[] = [];

  // IMAGE 1 — Hairstyle: cinematic close-up portrait, face is the focus
  const topHair = hairRecommendations[0];
  if (topHair) {
    items.push({
      name: topHair,
      prompt: `The same ${personStr} from the input photo with a ${topHair} hairstyle. Close-up portrait focused on the face and hair. Same face, same skin, same features — only the hairstyle changes. Golden hour warm light hitting one side of the face, soft bokeh background, natural skin texture, sharp eyes, cinematic color grade with warm tones. Professional 85mm lens, f/1.4 shallow depth of field, ultra realistic, photorealistic, 8K resolution, masterpiece portrait photography.`,
    });
  }

  // Determine outfit aesthetic — shared across both outfit prompts
  const combined        = (outfitStyle + " " + occasion).toLowerCase();
  const oldMoneyWords   = ["хар", "саарал", "navy", "classic", "formal", "tailored", "blazer", "elegant", "ёслол", "хурим", "ажлын", "хуяг", "дунд оны"];
  const luxuryWords     = ["casual", "street", "urban", "modern", "trendy", "өдөр тутам", "энгийн", "party", "sport", "хийморь"];
  const formalOccasions = ["interview", "wedding", "formal", "ёслол"];
  const matchesOld      = oldMoneyWords.some((k) => combined.includes(k)) || formalOccasions.some((k) => combined.includes(k));
  const matchesLuxury   = luxuryWords.some((k) => combined.includes(k));
  const outfitAesthetic = (matchesOld && !matchesLuxury)
    ? "old money aesthetic, timeless quiet luxury, understated elegance, minimal refined style"
    : "luxury lifestyle photography, modern premium fashion, elevated contemporary style";

  // IMAGE 2 — Outfit
  if (outfitStyle) {
    const aesthetic = outfitAesthetic;

    items.push({
      name: "Outfit Look",
      prompt: `The same ${personStr} from the input photo wearing ${outfitStyle} for ${occasion}. Only the clothing changes — same face, same features. Athletic symmetrical body, confident posture. ${aesthetic}. Natural soft daylight, cinematic color grade, fashion editorial style, realistic skin texture, shallow depth of field. Full body shot, centered composition, 85mm lens f/2.0, ultra photorealistic, professional fashion shoot, high detail, elegant urban atmosphere, 8K, masterpiece.`,
    });
  }

  // Pro: second hair variation
  if (isPro && hairRecommendations[1]) {
    items.push({
      name: hairRecommendations[1],
      prompt: `The same ${personStr} from the input photo with a ${hairRecommendations[1]} hairstyle. Close-up portrait focused on face and hair. Same face, same skin — only the hairstyle changes. Soft studio lighting, natural skin texture, sharp eyes, cinematic color grade, shallow depth of field. Ultra realistic, photorealistic, 8K, masterpiece portrait photography.`,
    });
  }

  // Pro: second outfit variation
  if (isPro && outfitStyle) {
    items.push({
      name: "Outfit Look 2",
      prompt: `The same ${personStr} from the input photo wearing an alternative ${outfitStyle} look for ${occasion} with a different silhouette. Only the clothing changes. Athletic symmetrical body. ${outfitAesthetic}. Natural soft daylight, cinematic color grade, full body shot, centered, 85mm lens f/2.0, ultra photorealistic, 8K, masterpiece fashion editorial.`,
    });
  }

  // Pro bonus
  if (isPro) {
    items.push({
      name: "Casual Look",
      prompt: `The same person from the input photo. Wearing a stylish casual outfit for ${occasion}. Only the clothing is changed. Professional studio: clean background, natural soft lighting, sharp focus, photorealistic, 8K.`,
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
