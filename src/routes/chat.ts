import { Router, Request, Response } from "express";
import { InferenceClient } from "@huggingface/inference";
import { config } from "../config";
import { requireAuth, requirePro } from "../middleware/auth";

const router  = Router();
const client  = new InferenceClient(config.hf.token);
const MODEL   = "meta-llama/Meta-Llama-3-8B-Instruct";

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
      const messages = [
        { role: "system" as const,    content: SYSTEM_PROMPT },
        ...((history ?? []).slice(-10) as Array<{ role: "user" | "assistant"; content: string }>),
        { role: "user" as const, content: message },
      ];

      const result = await client.chatCompletion({
        model:      MODEL,
        messages,
        max_tokens: 600,
      });

      const reply = result.choices[0]?.message?.content ?? "";
      res.json({ reply });
    } catch (err) {
      console.error("[chat] HF error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Хариу боловсруулахад алдаа гарлаа" });
    }
  }
);

export default router;
