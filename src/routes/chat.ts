import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { config } from "../config";
import { requireAuth, requirePro } from "../middleware/auth";

const router = Router();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

const SYSTEM_PROMPT = `Та Looka Beauty AI платформын хувийн AI стилист юм. Монгол хэрэглэгчдэд хувцас, үс засал, грим, стилийн талаар мэргэжлийн зөвлөгөө өгнө.

Дараах зарчмуудыг баримтал:
- Монгол хэл дээр хариул
- Хэрэглэгчийн нөхцөл байдалд тохирсон тодорхой, практик зөвлөгөө өг
- Монгол уур амьсгал, 4 улирал, соёлыг харгалз
- Outfit, hairstyle, makeup look-уудыг нэрлэж тайлбарла
- Богино, тодорхой хариулт өг`;

router.post(
  "/message",
  requireAuth,
  requirePro,
  async (req: Request, res: Response) => {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message шаардлагатай" });
      return;
    }

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...((history ?? []).slice(-10) as OpenAI.Chat.ChatCompletionMessageParam[]),
        { role: "user", content: message },
      ];

      const completion = await openai.chat.completions.create({
        model:      "gpt-4o",
        messages,
        max_tokens: 600,
      });

      const reply = completion.choices[0]?.message?.content ?? "";
      res.json({ reply });
    } catch (err) {
      console.error("[chat] error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Хариу боловсруулахад алдаа гарлаа" });
    }
  }
);

export default router;
