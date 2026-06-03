import { config } from "../config";

const BASE = "https://merchant.qpay.mn/v2";

interface QPayToken {
  access_token: string;
  expires_at: number;
}

interface QPayUrl {
  name: string;
  description: string;
  logo: string;
  link: string;
}

interface QPayInvoiceResponse {
  invoice_id: string;
  qr_text: string;
  qr_image: string;
  payment_url: string;
  urls: QPayUrl[];
}

interface QPayCheckResponse {
  count: number;
  paid_amount: number;
  rows: { payment_status: string; payment_id: string }[];
}

let cachedToken: QPayToken | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  const basic = Buffer.from(
    `${config.qpay.username}:${config.qpay.password}`
  ).toString("base64");

  const res = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    throw new Error(`QPay auth failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 30) * 1000,
  };

  return cachedToken.access_token;
}

async function qpayRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QPay error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function createInvoice(params: {
  invoiceNo: string;
  amount: number;
  description: string;
  callbackUrl?: string;
}): Promise<QPayInvoiceResponse> {
  return qpayRequest<QPayInvoiceResponse>("/invoice", "POST", {
    invoice_code:          config.qpay.invoiceCode,
    sender_invoice_no:     params.invoiceNo,
    invoice_receiver_code: "terminal",
    sender_branch_code:    config.qpay.username,
    invoice_description:   params.description,
    amount:                params.amount,
    callback_url:          params.callbackUrl,
  });
}

export async function checkPayment(invoiceId: string): Promise<{ paid: boolean; amount: number }> {
  const data = await qpayRequest<QPayCheckResponse>("/payment/check", "POST", {
    object_type: "INVOICE",
    object_id:   invoiceId,
    offset:      { page_number: 1, page_limit: 100 },
  });

  const paid = data.rows?.some((r) => r.payment_status === "PAID") ?? false;
  return { paid, amount: data.paid_amount ?? 0 };
}
