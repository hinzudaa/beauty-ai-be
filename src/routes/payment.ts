import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { createInvoice, checkPayment } from "../services/qpay";
import { Payment } from "../models/payment";
import { User } from "../models/user";
import { getSetting } from "../models/settings";
import { sendAdminPush } from "../services/push";

const router = Router();

const PLAN_DEFAULTS: Record<string, number> = {
  basicPrice:    19900,
  standardPrice: 34900,  // Option A
  proPrice:      59900,  // Option A
};

const PLAN_DESC: Record<string, string> = {
  basic:    "Looka — Basic захиалга (сард 5 шинжилгээ · 2 AI look)",
  standard: "Looka — Standard захиалга (сард 10 шинжилгээ · 2 AI look)",
  pro:      "Looka — Pro захиалга (сард 10 шинжилгээ · 4 AI look + Chat)",
};

const MS_30 = 30 * 24 * 60 * 60 * 1000;

/** Calculate pro-rated upgrade price.
 *  Returns the full price if the user has no active subscription or is on the same plan.
 */
async function calcUpgradePrice(
  userId: string,
  newPlan: "basic" | "standard" | "pro"
): Promise<{ amount: number; discount: number; remainingDays: number }> {
  const fullPrice = await getSetting<number>(
    newPlan === "pro" ? "proPrice" : newPlan === "standard" ? "standardPrice" : "basicPrice",
    PLAN_DEFAULTS[newPlan === "pro" ? "proPrice" : newPlan === "standard" ? "standardPrice" : "basicPrice"]
  );

  const user = await User.findById(userId);
  const sub  = user?.subscription;
  const now  = new Date();

  // No active sub, expired, or same plan → full price
  if (!sub || sub.status !== "active" || sub.expiresAt <= now || sub.plan === newPlan) {
    return { amount: fullPrice, discount: 0, remainingDays: 0 };
  }

  const remainingMs       = sub.expiresAt.getTime() - now.getTime();
  const remainingFraction = Math.min(1, remainingMs / MS_30);
  const remainingDays     = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  const currentPrice = await getSetting<number>(
    sub.plan === "pro" ? "proPrice" : sub.plan === "standard" ? "standardPrice" : "basicPrice",
    PLAN_DEFAULTS[sub.plan === "pro" ? "proPrice" : sub.plan === "standard" ? "standardPrice" : "basicPrice"]
  );

  const discount = Math.round(remainingFraction * currentPrice);
  const amount   = Math.max(100, fullPrice - discount);   // min 100₮

  return { amount, discount, remainingDays };
}

/* ── GET /payment/upgrade-price?plan=pro ──────────────────────────
   Returns the pro-rated upgrade price for display in the frontend.
─────────────────────────────────────────────────────────────────── */
router.get("/upgrade-price", requireAuth, async (req: Request, res: Response) => {
  const plan = req.query.plan as string;
  if (!["basic","standard","pro"].includes(plan)) {
    res.status(400).json({ error: "plan must be basic, standard or pro" });
    return;
  }

  try {
    const { amount, discount, remainingDays } = await calcUpgradePrice(req.userId!, plan as "basic" | "standard" | "pro");
    const fullPrice = await getSetting<number>(
      plan === "pro" ? "proPrice" : plan === "standard" ? "standardPrice" : "basicPrice",
      PLAN_DEFAULTS[plan === "pro" ? "proPrice" : plan === "standard" ? "standardPrice" : "basicPrice"]
    );
    res.json({ amount, discount, fullPrice, remainingDays, isUpgrade: discount > 0 });
  } catch (err) {
    console.error("[payment] upgrade-price error:", err);
    res.status(500).json({ error: "Үнэ тооцоолоход алдаа гарлаа" });
  }
});

/* ── POST /payment/invoice ────────────────────────────────────────
   Creates a QPay invoice. If the user is upgrading, automatically
   applies the pro-rated discount (remaining plan value deducted).
─────────────────────────────────────────────────────────────────── */
router.post("/invoice", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const plan = (req.body as { feature?: string }).feature as "basic" | "standard" | "pro";
    if (!["basic","standard","pro"].includes(plan)) {
      res.status(400).json({ error: "feature нь 'basic' эсвэл 'pro' байх ёстой" });
      return;
    }

    const callbackUrl = process.env.APP_BASE_URL
      ? `${process.env.APP_BASE_URL}/payment/callback`
      : undefined;

    // Server-side pro-rating (prevents price manipulation from client)
    const { amount, discount } = await calcUpgradePrice(String(user._id), plan);

    const desc = discount > 0
      ? `${PLAN_DESC[plan]} [Upgrade: -${discount.toLocaleString()}₮ хасагдсан]`
      : PLAN_DESC[plan];

    const invoice = await createInvoice({
      invoiceNo:   randomUUID(),
      amount,
      description: desc,
      callbackUrl,
    });

    await Payment.create({
      userId:    user._id,
      phone:     user.phone,
      invoiceId: invoice.invoice_id,
      amount,
      status:    "pending",
      type:      plan,
    });

    res.json({
      invoiceId:  invoice.invoice_id,
      qrImage:    invoice.qr_image,
      qrText:     invoice.qr_text,
      paymentUrl: invoice.payment_url,
      urls:       invoice.urls ?? [],
      amount,
      discount,
      isUpgrade:  discount > 0,
    });
  } catch (err) {
    console.error("[payment] create invoice error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Төлбөрийн нэхэмжлэх үүсгэхэд алдаа гарлаа" });
  }
});

router.get("/check/:invoiceId", requireAuth, async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const result    = await checkPayment(invoiceId);

    if (result.paid) {
      const payment = await Payment.findOneAndUpdate(
        { invoiceId },
        { status: "paid", paidAt: new Date() },
        { new: true }
      );

      if (payment && (payment.type === "basic" || payment.type === "standard" || payment.type === "pro")) {
        // Push notification to admin when plan is purchased
        const planLabel = payment.type === "pro" ? "Pro" : payment.type === "standard" ? "Standard" : "Basic";
        sendAdminPush({
          title: `💳 Шинэ захиалга — ${planLabel}`,
          body:  `${payment.phone} · ₮${payment.amount.toLocaleString()}`,
          icon:  "/icon-192.png",
          url:   "/dashboard/payments",
        }).catch(() => {});
        const now       = new Date();
        const expiresAt = new Date(now.getTime() + MS_30);

        // For upgrades: extend from existing expiry if still active
        const existingUser = await User.findById(payment.userId);
        const existingSub  = existingUser?.subscription;
        const startFrom    =
          existingSub?.status === "active" && existingSub.expiresAt > now
            ? existingSub.expiresAt
            : now;

        await User.findByIdAndUpdate(payment.userId, {
          subscription: {
            plan:         payment.type,
            status:       "active",
            startedAt:    now,
            expiresAt:    new Date(startFrom.getTime() + MS_30),
            monthlyUsage: 0,
            usageResetAt: expiresAt,
          },
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[payment] check error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Төлбөрийн статус шалгахад алдаа гарлаа" });
  }
});

router.post("/callback", (_req: Request, res: Response) => {
  res.sendStatus(200);
});

export default router;
