import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/user";
import { Payment } from "../models/payment";
import { UsageLog } from "../models/usageLog";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId).lean();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [payments, usageAgg] = await Promise.all([
    Payment.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    UsageLog.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: "$feature", count: { $sum: 1 } } },
    ]),
  ]);

  const usage: Record<string, number> = { analyze: 0, outfit: 0, hairstyle: 0 };
  for (const u of usageAgg) { if (u._id) usage[u._id as string] = u.count as number; }

  res.json({
    user: {
      id:            user._id,
      phone:         user.phone,
      phoneVerified: user.phoneVerified,
      createdAt:     user.createdAt,
    },
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

export default router;
