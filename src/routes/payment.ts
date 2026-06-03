import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { createInvoice, checkPayment } from "../services/qpay";
import { Payment } from "../models/payment";
import { User } from "../models/user";
import { getSetting } from "../models/settings";
import { config } from "../config";

const router = Router();

const FEATURE_KEYS: Record<string, string> = {
  analyze:   "analyzePrice",
  outfit:    "outfitPrice",
  hairstyle: "hairstylePrice",
};

const FEATURE_DESC: Record<string, string> = {
  analyze:   "Beauty AI — нүүрний шинжилгээ",
  outfit:    "Beauty AI — хувцасны зөвлөмж",
  hairstyle: "Beauty AI — үс засал & грим",
};

router.post("/invoice", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const feature = (req.body as { feature?: string }).feature ?? "analyze";
    const priceKey = FEATURE_KEYS[feature] ?? "analyzePrice";

    const callbackUrl = config.appBaseUrl
      ? `${config.appBaseUrl}/payment/callback`
      : undefined;

    const amount = await getSetting<number>(priceKey, config.qpay.amount);

    const invoice = await createInvoice({
      invoiceNo:   randomUUID(),
      amount,
      description: FEATURE_DESC[feature] ?? "Beauty AI",
      callbackUrl,
    });

    await Payment.create({
      userId:    user._id,
      phone:     user.phone,
      invoiceId: invoice.invoice_id,
      amount,
      status:    "pending",
      type:      feature,
    });

    res.json({
      invoiceId:  invoice.invoice_id,
      qrImage:    invoice.qr_image,
      qrText:     invoice.qr_text,
      paymentUrl: invoice.payment_url,
      urls:       invoice.urls ?? [],
      amount:     config.qpay.amount,
    });
  } catch (err) {
    console.error("[payment] create invoice error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Төлбөрийн нэхэмжлэх үүсгэхэд алдаа гарлаа" });
  }
});

router.get("/check/:invoiceId", requireAuth, async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const result = await checkPayment(invoiceId);

    if (result.paid) {
      await Payment.findOneAndUpdate(
        { invoiceId },
        { status: "paid", paidAt: new Date() }
      );
    }

    res.json(result);
  } catch (err) {
    console.error("[payment] check error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Төлбөрийн статус шалгахад алдаа гарлаа" });
  }
});

router.post("/callback", (req: Request, res: Response) => {
  res.sendStatus(200);
});

export default router;
