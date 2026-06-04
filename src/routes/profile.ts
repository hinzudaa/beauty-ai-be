import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { Payment } from "../models/payment";
import { UsageLog } from "../models/usageLog";
import { Analysis } from "../models/analysis";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [payments, usageAgg] = await Promise.all([
    Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    UsageLog.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: "$feature", count: { $sum: 1 } } },
    ]),
  ]);

  const usage: Record<string, number> = { full: 0 };
  for (const u of usageAgg) { if (u._id) usage[u._id as string] = u.count as number; }

  const sub = user.subscription;
  const now = new Date();

  res.json({
    user: {
      id:            user._id,
      phone:         user.phone,
      phoneVerified: user.phoneVerified,
      createdAt:     user.createdAt,
    },
    subscription: sub ? {
      plan:           sub.plan,
      status:         sub.status === "active" && sub.expiresAt > now ? "active" : "expired",
      expiresAt:      sub.expiresAt,
      monthlyUsage:   sub.monthlyUsage,
      usageLimit:     sub.plan === "pro" ? 20 : 5,
      usageRemaining: Math.max(0, (sub.plan === "pro" ? 20 : 5) - sub.monthlyUsage),
    } : null,
    payments: payments.map((p) => ({
      invoiceId: p.invoiceId,
      amount:    p.amount,
      status:    p.status,
      type:      p.type,
      createdAt: p.createdAt,
      paidAt:    p.paidAt,
    })),
    usage,
  });
});

/** GET /profile/analyses — past looksmaxxing results (newest first) */
router.get("/analyses", requireAuth, async (req: Request, res: Response) => {
  const page  = parseInt(String(req.query.page  ?? "1"),  10);
  const limit = parseInt(String(req.query.limit ?? "10"), 10);
  const skip  = (page - 1) * limit;

  const [analyses, total] = await Promise.all([
    Analysis.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Analysis.countDocuments({ userId: req.userId }),
  ]);

  res.json({
    data: analyses.map((a) => ({
      id:        a._id,
      photoUrl:  a.photoUrl,
      analysis:  a.analysis,
      looks:     a.looks,
      occasion:  a.occasion,
      createdAt: a.createdAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

export default router;
