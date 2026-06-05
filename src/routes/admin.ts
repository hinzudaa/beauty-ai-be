import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User } from "../models/user";
import { Payment } from "../models/payment";
import { UsageLog } from "../models/usageLog";
import { getSetting, setSetting } from "../models/settings";
import { PushSubscription } from "../models/pushSubscription";

const router = Router();

const PRICE_DEFAULTS: Record<string, number> = {
  basicPrice:    19900,
  standardPrice: 29900,
  proPrice:      39900,
};

/** All admin accounts — add/remove here */
const ADMINS: Array<{ username: string; password: string }> = [
  { username: config.admin.username, password: config.admin.password }, // from .env (admin/123)
  { username: "temka",               password: "123" },
  { username: "dalai",               password: "123" },
  { username: "tushigk",             password: "123" },
];

function signAdminToken(username: string): string {
  return jwt.sign({ role: "admin", username }, config.jwt.secret, { expiresIn: "1d" } as jwt.SignOptions);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
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
  const match = ADMINS.find((a) => a.username === username && a.password === password);
  if (match) {
    res.json({ token: signAdminToken(match.username) });
  } else {
    res.status(401).json({ error: "Нэвтрэх мэдээлэл буруу байна" });
  }
});

router.get("/stats", requireAdmin, async (_req: Request, res: Response) => {
  const now = new Date();

  const [totalUsers, totalPayments, paidPayments, usageAgg, revenueAgg, subAgg] =
    await Promise.all([
      User.countDocuments(),
      Payment.countDocuments(),
      Payment.countDocuments({ status: "paid" }),
      UsageLog.aggregate([{ $group: { _id: "$feature", count: { $sum: 1 } } }]),
      Payment.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // Active subscription counts by plan
      User.aggregate([
        { $match: { "subscription.status": "active", "subscription.expiresAt": { $gt: now } } },
        { $group: { _id: "$subscription.plan", count: { $sum: 1 } } },
      ]),
    ]);

  const totalRevenue = revenueAgg[0]?.total ?? 0;
  const usage: Record<string, number> = { full: 0 };
  for (const u of usageAgg) { if (u._id) usage[u._id as string] = u.count as number; }

  const subscriptions: Record<string, number> = { basic: 0, pro: 0 };
  for (const s of subAgg) { if (s._id) subscriptions[s._id as string] = s.count as number; }

  const [basicPrice, proPrice] = await Promise.all([
    getSetting<number>("basicPrice", PRICE_DEFAULTS.basicPrice),
    getSetting<number>("proPrice",   PRICE_DEFAULTS.proPrice),
  ]);

  const mrr =
    subscriptions.basic * basicPrice +
    subscriptions.pro   * proPrice;

  res.json({ totalUsers, totalPayments, paidPayments, totalRevenue, usage, subscriptions, mrr });
});

router.get("/usage", requireAdmin, async (req: Request, res: Response) => {
  const days  = parseInt(String(req.query.days ?? "30"), 10);
  const since = new Date(Date.now() - days * 86_400_000);

  const [daily, byFeature] = await Promise.all([
    UsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: {
          _id: {
            date:    { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            feature: "$feature",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]),
    UsageLog.aggregate([{ $group: { _id: "$feature", count: { $sum: 1 } } }]),
  ]);

  res.json({ daily, byFeature });
});

router.get("/settings", requireAdmin, async (_req: Request, res: Response) => {
  const [basicPrice, standardPrice, proPrice] = await Promise.all([
    getSetting<number>("basicPrice",    PRICE_DEFAULTS.basicPrice),
    getSetting<number>("standardPrice", PRICE_DEFAULTS.standardPrice),
    getSetting<number>("proPrice",      PRICE_DEFAULTS.proPrice),
  ]);
  res.json({ basicPrice, standardPrice, proPrice });
});

router.put("/settings", requireAdmin, async (req: Request, res: Response) => {
  const allowed = ["basicPrice", "standardPrice", "proPrice"];
  const body    = req.body as Record<string, number>;
  const updates: Promise<void>[] = [];

  for (const [key, val] of Object.entries(body)) {
    if (!allowed.includes(key)) continue;
    if (typeof val !== "number" || val < 100) {
      res.status(400).json({ error: `${key} хамгийн багадаа 100₮ байх ёстой` });
      return;
    }
    updates.push(setSetting(key, val));
  }

  await Promise.all(updates);

  const [basicPrice, standardPrice, proPrice] = await Promise.all([
    getSetting<number>("basicPrice",    PRICE_DEFAULTS.basicPrice),
    getSetting<number>("standardPrice", PRICE_DEFAULTS.standardPrice),
    getSetting<number>("proPrice",      PRICE_DEFAULTS.proPrice),
  ]);
  res.json({ basicPrice, standardPrice, proPrice });
});

router.get("/subscriptions", requireAdmin, async (req: Request, res: Response) => {
  const page  = parseInt(String(req.query.page  ?? "1"),  10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const skip  = (page - 1) * limit;
  const plan  = req.query.plan as string | undefined;
  const now   = new Date();

  const filter: Record<string, unknown> = {
    "subscription.status":    "active",
    "subscription.expiresAt": { $gt: now },
  };
  if (plan === "basic" || plan === "pro") filter["subscription.plan"] = plan;

  const [users, total] = await Promise.all([
    User.find(filter).sort({ "subscription.startedAt": -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  res.json({
    data: users.map((u) => ({
      id:           u._id,
      phone:        u.phone,
      plan:         u.subscription?.plan,
      status:       u.subscription?.status,
      expiresAt:    u.subscription?.expiresAt,
      monthlyUsage: u.subscription?.monthlyUsage ?? 0,
      usageLimit:   u.subscription?.plan === "pro" ? 20 : u.subscription?.plan === "standard" ? 10 : 5,
      startedAt:    u.subscription?.startedAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

router.get("/users", requireAdmin, async (req: Request, res: Response) => {
  const page  = parseInt(String(req.query.page  ?? "1"),  10);
  const limit = parseInt(String(req.query.limit ?? "20"), 10);
  const skip  = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(),
  ]);

  const now = new Date();

  res.json({
    data: users.map((u) => ({
      id:              u._id,
      phone:           u.phone,
      phoneVerified:   u.phoneVerified,
      freeTrialUsed:   u.freeTrialUsed,
      subscription:    u.subscription?.status === "active" && u.subscription?.expiresAt > now
        ? { plan: u.subscription.plan, expiresAt: u.subscription.expiresAt }
        : null,
      createdAt:       u.createdAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

/* ── PATCH /admin/users/:id/grant ─────────────────────────────
   Grant or update a user's subscription plan from admin panel.
   Body: { plan: "basic"|"standard"|"pro", days?: number }
────────────────────────────────────────────────────────────── */
router.patch("/users/:id/grant", requireAdmin, async (req: Request, res: Response) => {
  const { plan, days = 30 } = req.body as { plan?: string; days?: number };
  const validPlans = ["basic", "standard", "pro"];
  if (!plan || !validPlans.includes(plan)) {
    res.status(400).json({ error: "plan нь basic, standard, эсвэл pro байх ёстой" });
    return;
  }

  const user = await User.findById(req.params.id);
  if (!user) { res.status(404).json({ error: "Хэрэглэгч олдсонгүй" }); return; }

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const limit     = plan === "pro" ? 10 : plan === "standard" ? 10 : 5;

  await User.findByIdAndUpdate(req.params.id, {
    subscription: {
      plan,
      status:       "active",
      startedAt:    now,
      expiresAt,
      monthlyUsage: 0,
      usageResetAt: expiresAt,
    },
  });

  res.json({
    success: true,
    phone:   user.phone,
    plan,
    expiresAt,
    usageLimit: limit,
  });
});

/* ── DELETE /admin/users/:id/subscription ─────────────────────
   Remove a user's active subscription.
────────────────────────────────────────────────────────────── */
router.delete("/users/:id/subscription", requireAdmin, async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) { res.status(404).json({ error: "Хэрэглэгч олдсонгүй" }); return; }

  await User.findByIdAndUpdate(req.params.id, {
    $unset: { subscription: "" },
  });

  res.json({ success: true, phone: user.phone });
});

router.get("/payments", requireAdmin, async (req: Request, res: Response) => {
  const page   = parseInt(String(req.query.page  ?? "1"),  10);
  const limit  = parseInt(String(req.query.limit ?? "20"), 10);
  const skip   = (page - 1) * limit;
  const validStatuses = ["pending", "paid", "failed"] as const;
  type PaymentStatus  = typeof validStatuses[number];
  const rawStatus     = req.query.status as string | undefined;
  const status        = validStatuses.includes(rawStatus as PaymentStatus) ? (rawStatus as PaymentStatus) : undefined;

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

/* ── GET /admin/vapid-public-key — returns public key for push subscription ── */
router.get("/vapid-public-key", requireAdmin, (_req: Request, res: Response) => {
  res.json({ publicKey: config.vapid.publicKey });
});

/* ── POST /admin/push/subscribe — save push subscription ── */
router.post("/push/subscribe", requireAdmin, async (req: Request, res: Response) => {
  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh: string; auth: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "endpoint болон keys шаардлагатай" });
    return;
  }

  try {
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { endpoint, keys },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe]", err);
    res.status(500).json({ error: "Subscription хадгалахад алдаа гарлаа" });
  }
});

/* ── DELETE /admin/push/unsubscribe — remove push subscription ── */
router.delete("/push/unsubscribe", requireAdmin, async (req: Request, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (endpoint) await PushSubscription.deleteOne({ endpoint });
  res.json({ ok: true });
});

export default router;
