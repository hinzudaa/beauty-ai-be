import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { requireAuth, requireAccess } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/* ── Prompts ─────────────────────────────────────────────────────── */

const FACE_PROMPT = `Энэ зурган дах хүний царайг шинжлээд зөвхөн дараах JSON форматаар хариул.
Нэмэлт тайлбар, markdown оруулахгүй — зөвхөн JSON объект.

{
  "faceShape": "царайны хэлбэр монгол хэлээр (Зууван, Дугуй, Дөрвөлжин, Зүрх хэлбэрт, Алмаз, Урт гэснийн аль нэг)",
  "skinTone": "арьсны тон монгол хэлээр (жишээ: Дулаан дунд, Хүйтэн цайвар, Нейтрал дунд гэх мэт)",
  "styleType": "style төрөл монгол хэлээр (жишээ: Байгалийн минималист, Зоригтой класик, Нежный феминин гэх мэт)",
  "recommendations": ["5 зөвлөмж монгол хэлээр — нүүрний хэлбэр, арьсны тонд тохирсон хувцас, гоо сайхан, аксессуарын зөвлөмж"],
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]
}
colorPalette нь арьсны тонд тохирсон 5 өнгийн hex код байна.`;

const HAIR_PROMPT = `Та hair stylist болон makeup artist юм. Зурган дах хүний нүүрийг шинжлээд монгол хэлээр хариул.
Зөвхөн JSON, нэмэлт тайлбаргүй:
{
  "faceShape": "нүүрний хэлбэр монгол хэлээр",
  "hair": [
    { "name": "Үсний загварын нэр", "length": "Богино/Дунд/Урт", "desc": "Тайлбар монгол хэлээр" }
  ],
  "makeup": [
    { "name": "Makeup look нэр", "desc": "Тайлбар монгол хэлээр", "colors": ["#hex1","#hex2","#hex3"] }
  ]
}
hair: 4 загвар, makeup: 3 look санал өг.`;

const outfitPrompt = (event: string, season: string) => `
Та fashion stylist юм. Зурган дах хүний биеийн хэлбэр, арьсны тон, өнгөний онцлогийг харгалзан монгол хэлээр хариул.

Event: ${event}
Улирал: ${season}
Style: Minimal

Зурган дах хүнд тохирсон 2 outfit санал өг. Зөвхөн JSON, тайлбаргүй:
{
  "outfits": [
    {
      "name": "Outfit нэр",
      "items": ["5 хувцасны зүйл монгол+англи хосолсон"],
      "colors": ["#hex1", "#hex2", "#hex3"],
      "tip": "Стилистийн зөвлөмж монгол хэлээр — хүний онцлогт тохируулсан"
    }
  ]
}`.trim();

function getSeason(): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return "Хавар";
  if (m >= 5 && m <= 7) return "Зун";
  if (m >= 8 && m <= 10) return "Намар";
  return "Өвөл";
}

/* ── POST /analyze/full — all 3 in parallel, counts as 1 usage ───── */
router.post("/full", requireAuth, requireAccess, async (req: Request, res: Response) => {
  const { image, event = "casual" } = req.body as { image?: string; event?: string };
  if (!image) { res.status(400).json({ error: "image шаардлагатай" }); return; }

  const base64    = image.replace(/^data:image\/\w+;base64,/, "");
  const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
  const mime      = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const imgUrl    = `data:${mime};base64,${base64}`;
  const season    = getSeason();

  const imgContent = { type: "image_url" as const, image_url: { url: imgUrl, detail: "low" as const } };

  try {
    const [faceComp, hairComp, outfitComp] = await Promise.all([
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [imgContent, { type: "text", text: FACE_PROMPT }] }],
        response_format: { type: "json_object" },
        max_tokens: 600,
      }),
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [imgContent, { type: "text", text: HAIR_PROMPT }] }],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [imgContent, { type: "text", text: outfitPrompt(event, season) }] }],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    ]);

    const fc = faceComp.choices[0].message.content;
    const hc = hairComp.choices[0].message.content;
    const oc = outfitComp.choices[0].message.content;

    if (!fc || !hc || !oc) { res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" }); return; }

    const face   = JSON.parse(fc) as Record<string, unknown>;
    const hair   = JSON.parse(hc) as Record<string, unknown>;
    const outfit = JSON.parse(oc) as { outfits?: unknown[] };

    // Mark free trial used or increment monthly subscription usage (once per session)
    const user = await User.findById(req.userId);
    if (user) {
      if (req.isFreeTrial) {
        await User.findByIdAndUpdate(req.userId, { freeTrialUsed: true });
      } else {
        await User.findByIdAndUpdate(req.userId, { $inc: { "subscription.monthlyUsage": 1 } });
      }
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "full" }).catch(() => {});
    }

    res.json({ face, hair, outfits: outfit.outfits ?? [] });
  } catch (err) {
    console.error("[analyze/full] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Шинжилгээ хийхэд алдаа гарлаа" });
  }
});

export default router;
