import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const PROMPT = (event: string, season: string, style: string) => `
Та fashion stylist юм. Монгол хэлээр хариул.

Event: ${event}
Улирал: ${season}
Style: ${style}

Дараах JSON форматаар 2 outfit санал өг. Зөвхөн JSON, тайлбаргүй:
{
  "outfits": [
    {
      "name": "Outfit нэр (англи эсвэл монгол)",
      "items": ["5 хувцасны зүйл монгол+англи хосолсон"],
      "colors": ["#hex1", "#hex2", "#hex3"],
      "tip": "Стилистийн зөвлөмж монгол хэлээр"
    }
  ]
}`.trim();

export interface OutfitItem {
  name: string;
  items: string[];
  colors: string[];
  tip: string;
}

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { event, season, style } = req.body as { event?: string; season?: string; style?: string };

  if (!event || !season || !style) {
    res.status(400).json({ error: "event, season, style шаардлагатай" });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: PROMPT(event, season, style) }],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });

    const content = completion.choices[0].message.content;
    if (!content) { res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" }); return; }

    const parsed = JSON.parse(content) as { outfits: OutfitItem[] };
    if (!Array.isArray(parsed.outfits)) { res.status(500).json({ error: "AI буруу форматаар хариулсан" }); return; }

    const user = await User.findById(req.userId).lean();
    if (user) UsageLog.create({ userId: user._id, phone: user.phone, feature: "outfit" }).catch(() => {});

    res.json({ outfits: parsed.outfits });
  } catch (err) {
    console.error("[outfit] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Хувцасны зөвлөмж үүсгэхэд алдаа гарлаа" });
  }
});

export default router;
