import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog } from "../models/usageLog";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const PROMPT = `Энэ зурган дах хүний царайг шинжлээд зөвхөн дараах JSON форматаар хариул.
Нэмэлт тайлбар, markdown оруулахгүй — зөвхөн JSON объект.

{
  "faceShape": "царайны хэлбэр монгол хэлээр (Зууван, Дугуй, Дөрвөлжин, Зүрх хэлбэрт, Алмаз, Урт гэснийн аль нэг)",
  "skinTone": "арьсны тон монгол хэлээр (жишээ: Дулаан дунд, Хүйтэн цайвар, Нейтрал дунд гэх мэт)",
  "styleType": "style төрөл монгол хэлээр (жишээ: Байгалийн минималист, Зоригтой класик, Нежный феминин гэх мэт)",
  "recommendations": [
    "5 зөвлөмж монгол хэлээр — нүүрний хэлбэр, арьсны тонд тохирсон хувцас, гоо сайхан, аксессуарын зөвлөмж"
  ],
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"]
}

colorPalette нь арьсны тонд тохирсон 5 өнгийн hex код байна.`;

export interface AnalyzeResult {
  faceShape: string;
  skinTone: string;
  styleType: string;
  recommendations: string[];
  colorPalette: string[];
}

router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };

  if (!image) {
    res.status(400).json({ error: "image шаардлагатай" });
    return;
  }

  const base64 = image.replace(/^data:image\/\w+;base64,/, "");
  const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${base64}`,
                detail: "low",
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      res.status(500).json({ error: "AI хариу буцааж ирсэнгүй" });
      return;
    }

    const result = JSON.parse(content) as AnalyzeResult;

    if (
      !result.faceShape ||
      !result.skinTone ||
      !result.styleType ||
      !Array.isArray(result.recommendations) ||
      !Array.isArray(result.colorPalette)
    ) {
      res.status(500).json({ error: "AI буруу форматаар хариулсан" });
      return;
    }

    const user = await User.findById(req.userId).lean();
    if (user) {
      UsageLog.create({ userId: user._id, phone: user.phone, feature: "analyze" }).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    console.error("[analyze] error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Шинжилгээ хийхэд алдаа гарлаа" });
  }
});

export default router;
