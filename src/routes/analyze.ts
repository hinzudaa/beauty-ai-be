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
  "  - Хүн болгонд ӨВӨРМӨЦ оноо өгнө — ижил оноо давтагдах боломжгүй.",
  "  - Оноо 0.0001 нарийвчлалтай (4 оронтой бутархай). Жишээ: 6.7342, 7.4819, 8.2156",
  "  - Дараах 8 шалгуурыг тус бүрд 0–10 оноолж, жин дүүнтэй нэгтгэ:",
  "    1. Нүүрний тэгш хэм (симметр) — 25%",
  "    2. Алтан пропорц (golden ratio) нүүрний харьцаанд — 20%",
  "    3. Арьсны чанар, өнгө жигд байдал — 15%",
  "    4. Нүдний байрлал, хэлбэр, гайхамшиг — 15%",
  "    5. Эрүү, хацрын тод байдал — 10%",
  "    6. Хамар, уруулын пропорц — 10%",
  "    7. Нас харгалзсан залуу харагдах байдал — 3%",
  "    8. Нийт нүүрний гоо сайхны дуусгаврын impression — 2%",
  "  - Bell-curve: 1–4 дундаас доош (30%), 4–6 дундаж (40%), 6–8 дэвшилтэт (25%), 8–10 ховор (5%)",
  "  - Дээд оноо = 10.0000. Дундаж хүн = 5.0.",
  "",
  "{",
  '  "gender": "male эсвэл female",',
  '  "faceShape": "[МОНГОЛООР] Нүүрний хэлбэрийг нарийн тайлбарла — өргөн/урт харьцаа, эрүүний шугам, хацрын өндөр",',
  '  "lookmaxScore": Зургаас шууд уншаад тооцоолсон оноо 1-10 хооронд,  // 0.0000–10.0000, 0.0001 нарийвчлал — хүн болгонд өвөрмөц оноо',
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

  // Determine K-fashion aesthetic keywords from outfit analysis
  const ksName    = (typeof outfitStyle === "object" ? outfitStyle?.koreanStyle?.styleName : "") || "";
  const bestColor = (typeof outfitStyle === "object" ? outfitStyle?.bestColors?.[0] : "") || "black";
  const avoidNote = typeof outfitStyle === "object" && outfitStyle?.koreanStyle?.description ? outfitStyle.koreanStyle.description : "";

  // Pick editorial style based on occasion & outfit
  const combined = (outfitDesc + " " + ksName + " " + occasion).toLowerCase();
  const isY2K       = combined.includes("y2k") || combined.includes("street") || combined.includes("urban") || combined.includes("casual");
  const isOldMoney  = combined.includes("old money") || combined.includes("quiet luxury") || combined.includes("formal") || occasion === "interview" || occasion === "wedding";
  const isKdrama    = combined.includes("k-drama") || combined.includes("smart casual") || combined.includes("clean fit");

  const editorialStyle = isY2K
    ? "Y2K Korean street fashion editorial, bold Y2K energy, oversized silhouette, chain accessories, platform shoes, confident idol pose"
    : isOldMoney
    ? "Old Money Korean editorial, quiet luxury aesthetic, tailored silhouette, premium fabrics, understated elegance, clean minimal pose"
    : isKdrama
    ? "K-Drama Smart Casual editorial, Korean drama lead character style, refined everyday look, clean modern pose"
    : "K-Pop idol fashion editorial, premium Korean fashion magazine spread, confident model pose";

  // Shared collage layout instruction
  const collageLayout = `
Layout: K-pop fashion moodboard collage on white background.
CENTER (largest panel): full body portrait, main look.
TOP-LEFT panel: close-up face portrait, beauty shot.
TOP-RIGHT panel: back view or side profile.
BOTTOM-LEFT panel: seated or relaxed candid pose.
BOTTOM-RIGHT panel: cute chibi cartoon character version of the person, same outfit and hair, big eyes anime style.
Decorative accents between panels: small hand-drawn stars ★, hearts ♡, crowns 👑 in pink and black ink doodle style.
Small handwritten-style text labels: style notes, mood words.
Overall aesthetic: Korean idol fashion moodboard, Y2K editorial magazine spread, pink & black color palette.`.trim();

  // IMAGE 1 — Hair moodboard collage
  const topHair = hairNames[0];
  if (topHair) {
    items.push({
      name: topHair,
      prompt: `${collageLayout}
SUBJECT: The same ${personStr} from the input photo — same face, same skin, same features. ONLY the hairstyle changes to Korean ${topHair}.
All panels show the same ${personStr} with ${topHair} hair: center full body, top-left beauty close-up, top-right back view, bottom-left candid pose, bottom-right chibi figure.
Studio quality lighting, ultra photorealistic main panels, 8K, Korean beauty magazine quality.`,
    });
  }

  // Outfit aesthetic string for prompt
  const outfitAesthetic = outfitDesc
    || `${bestColor} Korean fashion, ${ksName || "K-pop street style"}`;

  // IMAGE 2 — Outfit moodboard collage
  if (outfitDesc || outfitStyle) {
    items.push({
      name: "Outfit Look",
      prompt: `${collageLayout}
SUBJECT: The same ${personStr} from the input photo — same face, same features. ONLY clothing changes to: ${outfitAesthetic}.
${avoidNote ? avoidNote + "." : ""}
All panels show the same ${personStr} in this outfit: center full body confident pose, top-left face close-up, top-right back view showing outfit details, bottom-left seated relaxed pose, bottom-right chibi cartoon figure in same outfit.
${editorialStyle}. Ultra photorealistic, 8K, Vogue Korea editorial quality.`,
    });
  }

  // Pro image 3: second hair moodboard
  if (isPro && hairNames[1]) {
    items.push({
      name: hairNames[1],
      prompt: `${collageLayout}
SUBJECT: The same ${personStr} from the input photo — same face, same features. ONLY hairstyle changes to Korean ${hairNames[1]}.
Golden hour outdoor version: warm backlight, soft bokeh background, natural skin texture.
All panels with ${hairNames[1]} hair: center full body, top-left beauty close-up, top-right profile view, bottom-left candid pose, bottom-right chibi figure.
Ultra photorealistic, 8K, K-drama lead character quality.`,
    });
  }

  // Pro image 4: second outfit moodboard — street style
  if (isPro && (outfitDesc || outfitStyle)) {
    items.push({
      name: "Street Look",
      prompt: `${collageLayout}
SUBJECT: The same ${personStr} from the input photo — same face, same features. Alternative ${outfitAesthetic} street look, different silhouette.
Urban Korean street setting across panels: center full body walking pose, top-left face close-up, top-right back view, bottom-left sitting on steps pose, bottom-right chibi figure.
Dynamic, confident, K-pop idol off-duty energy. Ultra photorealistic, 8K, editorial quality.`,
    });
  }
  // Pro total: 4 moodboard collage images

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
