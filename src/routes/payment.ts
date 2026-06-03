import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { createInvoice, checkPayment } from "../services/qpay";
import { config } from "../config";

const router = Router();

router.post("/invoice", requireAuth, async (req: Request, res: Response) => {
  try {
    const callbackUrl = config.appBaseUrl
      ? `${config.appBaseUrl}/payment/callback`
      : undefined;

    const invoice = await createInvoice({
      invoiceNo:   randomUUID(),
      amount:      config.qpay.amount,
      description: "Beauty AI — нүүрний шинжилгээ",
      callbackUrl,
    });

    res.json({
      invoiceId:  invoice.invoice_id,
      qrImage:    invoice.qr_image,   // raw base64, no data: prefix
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
    const result = await checkPayment(String(req.params.invoiceId));
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
