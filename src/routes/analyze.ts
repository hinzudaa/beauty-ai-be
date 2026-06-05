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
  "⚠️ ХЭЛНИЙ ДҮРЭМ: faceShape, features, hiddenStrengths, strengths, improvements, makeupTips, hairRecommendations.reason, outfitStyle талбаруудыг БҮГДИЙГ МОНГОЛ ХЭЛЭЭР бич. Англи хэл хориотой.",
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
  '  "lookmaxScore": 7.4819,  // 0.0000–10.0000, 0.0001 нарийвчлал — хүн болгонд өвөрмөц оноо',
  "",
  '  "features": {',
  '    "eyes":    "[МОНГОЛООР] Нүдний хэлбэр, өнгө, тэгш хэм — анзаардаггүй онцлогийг тодруул",',
  '    "jawline": "[МОНГОЛООР] Эрүүний байдал, хэлбэр — нүүрний нийт харагдалд нөлөөлж байгааг тайлбарла",',
  '    "chin":    "[МОНГОЛООР] Эрүүний доод хэсгийн тэнцвэр",',
  '    "nose":    "[МОНГОЛООР] Хамрын пропорц, үзүүр, нуруу",',
  '    "lips":    "[МОНГОЛООР] Уруулын дүүрэн байдал, хэлбэр, илэрхийлэл"',
  "  },",
  "",
  '  "skinTone": "Зургаас ШУУД уншсан арьсны бодит өнгө — Fitzpatrick scale (I–VI) болон тодорхой тайлбар. Жишээ: Fitzpatrick II, цайвар-дулаан зааглалтай, нүүрний хацар болон хүзүүний өнгийг харьцуулж тодорхойл",',
  '  "undertone": "Зургаас ШУУД уншсан undertone — судсыг (хөх=cool, ногоон=warm), мөн нүүрний сүүдрийн өнгийг харж тодорхойл (Warm / Cool / Neutral)",',
  '  "seasonalColor": "skinTone болон undertone-д үндэслэсэн seasonal color (Spring / Summer / Autumn / Winter) — хамгийн тохирох өнгийн улирал",',
  "",
  '  "hiddenStrengths": [',
  '    "[МОНГОЛООР] Бусад анзаардаг ч өөрөө мэдэхгүй 2–3 онцлог тал — тодорхой, лавтай"',
  "  ],",
  '  "strengths": ["[МОНГОЛООР] 3 давуу тал — шударга, практик"],',
  '  "improvements": [',
  '    "[МОНГОЛООР] 3–4 зөвлөмж: арьс арчлал, үс засалт, нүүр будалт, хирурги огт биш"',
  "  ],",
  "",
  '  "makeupTips": "[МОНГОЛООР] Нүүрний хэлбэрт тохирсон 1–2 нүүр будалтын тодорхой зөвлөгөө",',
  '  "hairRecommendations": [',
  '    "GENDER-ийг эхлээд тодорхойл.",',
  '    "",',
  '    "Хэрэв male бол зөвхөн эрэгтэй Korean hairstyle-аас сонго:",',
  '    "Two Block Cut, Comma Hair, Shadow Perm, Down Perm, Leaf Cut, Ivy League Korean, Textured Crop Korean, Dandy Cut, Curtain Hair (Korean Middle Part), Wolf Cut Men, Korean Mullet, Soft Mullet, Short Two Block Fade, Taper Fade Korean Style, Buzz Cut Korean Style, Caesar Cut Korean, Side Part Classic Korean, Slick Back Undercut, Middle Part Perm, Volume Perm Men, Natural Perm, Spiky Textured Cut, Crop Fade Korean, French Crop Korean Style, Edgar Cut Korean Style, Bro Flow Hairstyle, Long Layered Men Hair, Soft Perm Waves, Wet Look Hairstyle",',
  '    "",',
  '    "Хэрэв female бол зөвхөн эмэгтэй Korean hairstyle-аас сонго:",',
  '    "Hush Cut, Korean Layered Cut, Air Bangs, See-through Bangs, Korean Bob, Long Wave Perm, C-Curl Perm, S-Curl Layered Hair, Wolf Cut (Korean Style), Butterfly Cut, Jelly Perm, Root Perm, Digital Perm, Hime Cut (Korean version), Pixie Cut Korean Style, Soft Bob (Textured Bob), Lob (Long Bob), Straight Sleek Hair, Low Layer Cut, Face-Framing Layers, Feather Cut, Mermaid Waves, Volume C-Curl Bob, Shaggy Korean Cut, Curtain Bangs + Long Layers, Half Up Korean Style, Messy Bun K-style, Ponytail with Face Layers",',
  '    "",',
  '    "Нүүрний хэлбэр, эрүү, хацрын бүтэцтэй хамгийн зохицох 3 үс засалтыг эрэмбэлэн буцаа.",',
  '    "Зөвхөн Korean/K-Drama/K-Pop стиль ашигла.",',
  '    "Үс засалт бүрийн яагаад тохирохыг 1 өгүүлбэрээр МОНГОЛООР тайлбарла.",',
  '    "Формат: { \\"name\\": \\"...\\" , \\"reason\\": \\"...\\" }"',
  '  ],',
  '  "outfitStyle": {',
  '    "season": "seasonalColor дээр үндэслэсэн улирлын төрөл",',
  '    "bestColors": ["хамгийн зохих 5 хувцасны өнгө — skinTone+undertone+seasonalColor ашиглан сонго"],',
  '    "avoidColors": ["арьсны өнгийг бүдгэрүүлэх 3-5 өнгө"],',
  '    "koreanStyle": {',
  '      "styleName": "хамгийн тохирох Korean fashion style (Old Money Korean / Clean Fit Korean / Quiet Luxury Korean / K-Drama Smart Casual / K-Pop Street Fashion / Minimal Korean Aesthetic / Streetwear Oversized Korean / Business Casual Korean / Preppy Korean Style / Monochrome Korean Fit) өөр koreanStyle байж болно.",',
  '      "description": "[МОНГОЛООР] яагаад тохирохыг тайлбарла",',
  '      "tops": ["[МОНГОЛООР] дээд хувцасны 2 санал"],',
  '      "bottoms": ["[МОНГОЛООР] доод хувцасны 2 санал"],',
  '      "outerwear": ["[МОНГОЛООР] гадуур хувцасны 2 санал"]',
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
      model:           "gpt-4o-mini",
      temperature:     0.2,   // low = consistent results across repeated calls
      seed:            42,    // fixed seed for reproducibility
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url, detail: "high" } },
          { type: "text",      text: LOOKSMAX_PROMPT },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens:      4000,
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" });
      return;
    }

    // Robust JSON parse — GPT sometimes wraps in markdown code blocks
    let analysis: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
      const clean = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      analysis = JSON.parse(clean);
    } catch (parseErr) {
      console.error("[analyze/full] JSON parse error:", parseErr instanceof Error ? parseErr.message : parseErr);
      console.error("[analyze/full] raw content (first 500):", content.slice(0, 500));

      // Attempt to extract JSON object from anywhere in the string
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          analysis = JSON.parse(match[0]);
        } catch {
          res.status(500).json({ error: "AI хариу буруу форматтай байна. Дахин оролдоно уу." });
          return;
        }
      } else {
        res.status(500).json({ error: "AI хариу буруу форматтай байна. Дахин оролдоно уу." });
        return;
      }
    }

    // Validate minimum required fields
    if (!analysis.faceShape && !analysis.lookmaxScore) {
      console.error("[analyze/full] missing required fields:", Object.keys(analysis));
      res.status(500).json({ error: "AI дутуу хариу өгсөн байна. Дахин оролдоно уу." });
      return;
    }

    // Save analysis to DB — monthlyUsage increments only after generate-looks completes
    const saved = await Analysis.create({
      userId:   req.userId,
      photoUrl: url,
      analysis,
      looks:    [],
      occasion: event,
    });

    // Update user's lookScore (best ever, 0–100) — avatarUrl updated in generate-looks
    const rawScore = typeof analysis.lookmaxScore === "number" ? analysis.lookmaxScore : 0;
    // Convert 0–10 GPT score → 0–100 with 3 decimal precision (e.g. 7.4819 → 74.819)
    const newScore = Math.round(rawScore * 10 * 1000) / 1000;
    const existing = await User.findById(req.userId).select("lookScore").lean();
    const bestScore = Math.max(newScore, existing?.lookScore ?? 0);
    User.findByIdAndUpdate(req.userId, { lookScore: bestScore }).catch(() => {});

    res.json({ analysis, occasion: event, analysisId: String(saved._id) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[analyze/full]", msg);

    // Surface specific errors to frontend
    if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
      res.status(429).json({ error: "AI хэт ачаалалтай байна. 1 минутын дараа дахин оролдоно уу." });
    } else if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      res.status(504).json({ error: "AI хариу удааширлаа. Дахин оролдоно уу." });
    } else {
      res.status(500).json({ error: "Шинжилгээ хийхэд алдаа гарлаа. Дахин оролдоно уу." });
    }
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

  // ── Idempotency + generation lock ────────────────────────────
  if (analysisId) {
    const existing = await Analysis.findById(analysisId).select("looks generatingAt").lean();
    if (existing?.looks && existing.looks.length > 0) {
      res.json({ looks: existing.looks });   // already done — return cached
      return;
    }
    if (existing?.generatingAt) {
      const elapsed = Date.now() - new Date(existing.generatingAt).getTime();
      if (elapsed < 5 * 60 * 1000) {
        // Generation in progress (within 5 min) — tell client to wait & poll
        res.status(202).json({ status: "generating", message: "Зураг үүсгэж байна, түр хүлээнэ үү..." });
        return;
      }
    }
    // Set lock before starting
    await Analysis.findByIdAndUpdate(analysisId, { generatingAt: new Date() });
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

  // Match each Korean style name to its own category — checked in priority order (most specific first)
  const combined   = (ksName + " " + occasion).toLowerCase();
  const isOldMoney = combined.includes("old money") || combined.includes("quiet luxury") || combined.includes("formal") || occasion === "interview" || occasion === "wedding";
  const isKdrama   = combined.includes("k-drama") || combined.includes("smart casual") || combined.includes("clean fit");
  const isMinimal  = combined.includes("minimal") || combined.includes("monochrome");
  const isPreppy   = combined.includes("preppy");
  const isBusiness = combined.includes("business");
  const isStreet   = combined.includes("streetwear") || combined.includes("oversized");  // "streetwear" not "street" — avoids matching "K-Pop Street Fashion"
  const isKpop     = combined.includes("k-pop") || combined.includes("kpop") || combined.includes("idol");
  const isY2K      = combined.includes("y2k") || combined.includes("urban");

  const editorialStyle = isOldMoney
    ? "Old Money Korean editorial, quiet luxury aesthetic, tailored silhouette, premium fabrics, understated elegance, clean minimal pose"
    : isKdrama
    ? "K-Drama Smart Casual editorial, Korean drama lead character style, refined everyday look, clean modern pose"
    : isMinimal
    ? "Minimal Korean editorial, clean lines, tonal monochrome dressing, negative space composition, effortlessly understated pose"
    : isPreppy
    ? "Preppy Korean editorial, collegiate aesthetic, layered knitwear, plaid accents, clean campus energy, polished confident pose"
    : isBusiness
    ? "Business Casual Korean editorial, smart professional look, tailored blazer, pressed trousers, modern office aesthetic, poised powerful pose"
    : isStreet
    ? "Korean Streetwear editorial, oversized silhouette, layered fits, bold accessories, urban streetwear energy, confident street stance"
    : isKpop
    ? "K-Pop idol fashion editorial, stage-ready outfit, bold statement pieces, idol energy, dynamic powerful model pose"
    : isY2K
    ? "Y2K Korean street fashion editorial, bold Y2K energy, retro futuristic details, chain accessories, platform shoes, confident idol pose"
    : "K-fashion editorial, premium Korean fashion magazine spread, confident model pose";

  const outfitAesthetic = ksName || outfitDesc || `${bestColor} Korean fashion`;
  const vibe = isOldMoney
    ? (isMale ? "Old Money Guy"          : "Old Money Vibes")
    : isKdrama
    ? (isMale ? "K-Drama Lead"           : "K-Drama Heroine")
    : isMinimal
    ? (isMale ? "Minimal Aesthetic Guy"  : "Minimal Aesthetic Vibes")
    : isPreppy
    ? (isMale ? "Preppy K-Guy"           : "Preppy K-Girl Vibes")
    : isBusiness
    ? (isMale ? "Business Casual Guy"    : "Business Casual Vibes")
    : isStreet
    ? (isMale ? "Streetwear Guy Vibes"   : "Streetwear Girl Vibes")
    : isKpop
    ? (isMale ? "K-Pop It Guy Vibes"     : "K-Pop It Girl Vibes")
    : isY2K
    ? (isMale ? "Y2K Street Guy"         : "Y2K Street Vibes")
    : (isMale ? "K-Pop It Guy Vibes"     : "K-Pop It Girl Vibes");

  // Gender-specific moodboard labels & decorations
  const isMaleGen  = isMale;
  const decoColor  = isMaleGen ? "blue and black" : "pink and black";
  const decoIcons  = isMaleGen ? "stars ★ lightning ⚡ crowns ♛" : "crowns ♛ hearts ♡ stars ★";
  const beautyLbl  = isMaleGen ? "FACE FOCUS"    : "BEAUTY FOCUS";
  const candLbl    = isMaleGen ? "COOL & RELAXED" : "CANDID / RELAXED";
  const chibiLbl   = isMaleGen ? "CHIBI MASCOT"   : "CHIBI MASCOT";
  const chibiStyle = isMaleGen
    ? "cute chibi cartoon boy character same outfit same hair big eyes cool anime style"
    : "cute chibi cartoon girl character same outfit same hair big eyes kawaii anime style";

  // Moodboard collage prompt — matches the reference image layout
  const collage = (subject: string, label: string) =>
    `K-pop fashion moodboard collage, white background, 5 panels: ` +
    `top-left ${beautyLbl.toLowerCase()} close-up portrait, top-right back view or profile, ` +
    `center full body main look (largest panel), bottom-left candid relaxed ${isMaleGen ? "seated" : "posed"} pose, ` +
    `bottom-right ${chibiStyle}. ` +
    `${subject}. ${editorialStyle}. ` +
    `${decoColor} decorative accents: ${decoIcons} between panels. ` +
    `Handwritten text labels: "${beautyLbl}" "BACK VIEW / PROFILE" "${candLbl}" "${chibiLbl}" "MAIN LOOK: ${label}". ` +
    `Photorealistic panels + chibi anime. High quality, clean white layout.`;

  const topHair = hairNames[0];
  if (topHair) {
    items.push({
      name: topHair,
      prompt: collage(
        `Same ${personStr} with Korean ${topHair} hairstyle throughout all panels, same face`,
        topHair.toUpperCase()
      ),
    });
  }

  if (outfitDesc || outfitStyle) {
    items.push({
      name: "Outfit Look",
      prompt: collage(
        `Same ${personStr} wearing ${outfitAesthetic} throughout all panels, same face`,
        vibe
      ),
    });
  }

  if (isPro && hairNames[1]) {
    items.push({
      name: hairNames[1],
      prompt: collage(
        `Same ${personStr} with Korean ${hairNames[1]} hairstyle throughout all panels, same face`,
        hairNames[1].toUpperCase()
      ),
    });
  }

  if (isPro && (outfitDesc || outfitStyle)) {
    items.push({
      name: "Street Look",
      prompt: collage(
        `Same ${personStr} wearing ${outfitAesthetic} street style throughout all panels, same face`,
        "STREET LOOK"
      ),
    });
  }

  try {
    // Run ALL images in PARALLEL — much faster, 90s timeout each
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const falUrl      = await generateWithInstantID(imageUrl, item.prompt);
        const permanentUrl = await saveToCDN(falUrl);
        return { name: item.name, imageUrl: permanentUrl };
      })
    );

    // Keep successful results, log failures
    const looks: Array<{ name: string; imageUrl: string }> = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        looks.push(r.value);
      } else {
        console.error("[generate-looks] one image failed:", r.reason?.message ?? r.reason);
      }
    }

    if (looks.length === 0) {
      throw new Error("Бүх зураг үүсгэхэд алдаа гарлаа");
    }

    if (analysisId) {
      // Save looks + clear generation lock
      Analysis.findByIdAndUpdate(analysisId, { looks, generatingAt: null }).catch(() => {});
    }

    // Save first generated look as avatarUrl for leaderboard
    const firstLookUrl = looks[0]?.imageUrl;
    if (firstLookUrl) {
      User.findByIdAndUpdate(req.userId, { avatarUrl: firstLookUrl }).catch(() => {});
    }

    // Increment monthlyUsage only after looks are successfully generated
    if (user) {
      await User.findByIdAndUpdate(req.userId, { $inc: { "subscription.monthlyUsage": 1 } });
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "full" }).catch(() => {});
    }

    res.json({ looks });
  } catch (err) {
    // Clear generation lock on failure so user can retry
    if (analysisId) Analysis.findByIdAndUpdate(analysisId, { generatingAt: null }).catch(() => {});
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
