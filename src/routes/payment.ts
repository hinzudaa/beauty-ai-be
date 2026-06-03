import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { createInvoice, checkPayment } from "../services/qpay";
import { Payment } from "../models/payment";
import { User } from "../models/user";
import { getSetting } from "../models/settings";

const router = Router();

const PLAN_DEFAULTS: Record<string, number> = {
  basicPrice: 19999,
  proPrice:   29999,
};

const PLAN_DESC: Record<string, string> = {
  basic: "Looka Beauty AI — Basic захиалга (сард 20 ашиглалт)",
  pro:   "Looka Beauty AI — Pro захиалга (сард 40 ашиглалт + AI Стилист)",
};

router.post("/invoice", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const plan = (req.body as { feature?: string }).feature as "basic" | "pro";
    if (plan !== "basic" && plan !== "pro") {
      res.status(400).json({ error: "feature нь 'basic' эсвэл 'pro' байх ёстой" });
      return;
    }

    const priceKey    = plan === "basic" ? "basicPrice" : "proPrice";
    const callbackUrl = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL}/payment/callback` : undefined;
    const amount      = await getSetting<number>(priceKey, PLAN_DEFAULTS[priceKey]);

    const invoice = await createInvoice({
      invoiceNo:   randomUUID(),
      amount,
      description: PLAN_DESC[plan],
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

      // Activate or extend subscription when a plan invoice is confirmed
      if (payment && (payment.type === "basic" || payment.type === "pro")) {
        const now        = new Date();
        const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

        const existingUser = await User.findById(payment.userId);
        const existingSub  = existingUser?.subscription;
        const startFrom    =
          existingSub?.status === "active" && existingSub.expiresAt > now
            ? existingSub.expiresAt   // extend from current expiry if still active
            : now;

        await User.findByIdAndUpdate(payment.userId, {
          subscription: {
            plan:         payment.type,
            status:       "active",
            startedAt:    now,
            expiresAt:    new Date(startFrom.getTime() + MS_30_DAYS),
            monthlyUsage: 0,
            usageResetAt: new Date(now.getTime() + MS_30_DAYS),
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
