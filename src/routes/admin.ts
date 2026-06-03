import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User } from "../models/user";
import { Payment } from "../models/payment";
import { UsageLog } from "../models/usageLog";
import { getSetting, setSetting } from "../models/settings";

const router = Router();

function signAdminToken(): string {
  return jwt.sign({ role: "admin" }, config.jwt.secret, {
    expiresIn: "1d",
  } as jwt.SignOptions);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwt.secret) as { role?: string };
    if (payload.role !== "admin") throw new Error("Not admin");
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

router.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (
    username === config.admin.username &&
    password === config.admin.password
  ) {
    res.json({ token: signAdminToken() });
  } else {
    res.status(401).json({ error: "Нэвтрэх мэдээлэл буруу байна" });
  }
});

router.get("/stats", requireAdmin, async (_req: Request, res: Response) => {
  const [totalUsers, totalPayments, paidPayments, usageAgg, revenueAgg] = await Promise.all([
    User.countDocuments(),
    Payment.countDocuments(),
    Payment.countDocuments({ status: "paid" }),
    UsageLog.aggregate([{ $group: { _id: "$feature", count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);

  const totalRevenue = revenueAgg[0]?.total ?? 0;
  const usage: Record<string, number> = { analyze: 0, outfit: 0, hairstyle: 0 };
  for (const u of usageAgg) { if (u._id) usage[u._id as string] = u.count as number; }

  res.json({ totalUsers, totalPayments, paidPayments, totalRevenue, usage });
});

router.get("/usage", requireAdmin, async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days ?? "30"), 10);
  const since = new Date(Date.now() - days * 86_400_000);

  const [daily, byFeature] = await Promise.all([
    UsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, feature: "$feature" }, count: { $sum: 1 } } },
      { $sort: { "_id.date": 1 } },
    ]),
    UsageLog.aggregate([
      { $group: { _id: "$feature", count: { $sum: 1 } } },
    ]),
  ]);

  res.json({ daily, byFeature });
});

router.get("/settings", requireAdmin, async (_req: Request, res: Response) => {
  const analyzePrice = await getSetting<number>("analyzePrice", config.qpay.amount);
  res.json({ analyzePrice });
});

router.put("/settings", requireAdmin, async (req: Request, res: Response) => {
  const { analyzePrice } = req.body as { analyzePrice?: number };
  if (analyzePrice === undefined || typeof analyzePrice !== "number" || analyzePrice < 100) {
    res.status(400).json({ error: "analyzePrice хамгийн багадаа 100₮ байх ёстой" });
    return;
  }
  await setSetting("analyzePrice", analyzePrice);
  res.json({ analyzePrice });
});

router.get("/users", requireAdmin, async (req: Request, res: Response) => {
  const page  = parseInt(String(req.query.page  ?? "1"), 10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const skip  = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(),
  ]);

  res.json({
    data: users.map((u) => ({
      id:            u._id,
      phone:         u.phone,
      phoneVerified: u.phoneVerified,
      createdAt:     u.createdAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

router.get("/payments", requireAdmin, async (req: Request, res: Response) => {
  const page   = parseInt(String(req.query.page  ?? "1"), 10);
  const limit  = parseInt(String(req.query.limit ?? "20"), 10);
  const validStatuses = ["pending", "paid", "failed"] as const;
  type PaymentStatus = typeof validStatuses[number];
  const rawStatus = req.query.status as string | undefined;
  const status = validStatuses.includes(rawStatus as PaymentStatus) ? (rawStatus as PaymentStatus) : undefined;
  const skip   = (page - 1) * limit;

  const filter = status ? { status } : {};

  const [payments, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  res.json({
    data: payments.map((p) => ({
      id:        p._id,
      phone:     p.phone,
      invoiceId: p.invoiceId,
      amount:    p.amount,
      status:    p.status,
      type:      p.type,
      createdAt: p.createdAt,
      paidAt:    p.paidAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

export default router;
