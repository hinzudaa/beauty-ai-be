import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { UsageLog, Feature } from "../models/usageLog";

const router = Router();

const VALID: Feature[] = ["analyze", "outfit", "hairstyle"];

router.post("/log", requireAuth, async (req: Request, res: Response) => {
  const { feature } = req.body as { feature?: string };
  if (!feature || !VALID.includes(feature as Feature)) {
    res.status(400).json({ error: "feature шаардлагатай (analyze|outfit|hairstyle)" });
    return;
  }
  const user = await User.findById(req.userId).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await UsageLog.create({ userId: user._id, phone: user.phone, feature: feature as Feature });
  res.json({ ok: true });
});

export default router;
