import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const PROMPT = `Та hair stylist болон makeup artist юм. Зурган дах хүний нүүрийг шинжлээд монгол хэлээр хариул.
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

export interface HairItem { name: string; length: string; desc: string; }
export interface MakeupItem { name: string; desc: string; colors: string[]; }
export interface HairstyleResult {
  faceShape: string;
  hair: HairItem[];
  makeup: MakeupItem[];
}

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) { res.status(400).json({ error: "image шаардлагатай" }); return; }

  const base64 = image.replace(/^data:image\/\w+;base64,/, "");
  const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "low" } },
          { type: "text", text: PROMPT },
        ],
      }],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const content = completion.choices[0].message.content;
    if (!content) { res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" }); return; }

    const result = JSON.parse(content) as HairstyleResult;
    if (!result.faceShape || !Array.isArray(result.hair) || !Array.isArray(result.makeup)) {
      res.status(500).json({ error: "AI буруу форматаар хариулсан" }); return;
    }

    const user = await User.findById(req.userId).lean();
    if (user) UsageLog.create({ userId: user._id, phone: user.phone, feature: "hairstyle" }).catch(() => {});

    res.json(result);
  } catch (err) {
    console.error("[hairstyle] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Үсний шинжилгээ хийхэд алдаа гарлаа" });
  }
});

export default router;
