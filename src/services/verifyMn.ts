/**
 * verify.mn — Mongolia Mobile-Originated (MO) SMS phone verification
 *
 * Flow:
 *  1. createSession(phone)  → POST /sessions → returns sessionId + smsUri + displayInstruction
 *  2. Show displayInstruction to user. On mobile, offer smsUri as a tap-to-open link.
 *  3. User sends SMS to shortcode 144773.
 *  4. Poll checkSession(sessionId) every 3 s → sessionStatus === "VERIFIED"
 */

import { config } from "../config";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionStatus = "PENDING" | "VERIFIED" | "EXPIRED";

export interface CreateSessionResponse {
  sessionId: string;
  phone: string;
  shortcode: "144773";
  text: string;
  smsUri: string;
  displayInstruction: string;
  expiresAt: string;
}

export interface GetSessionResponse {
  sessionId: string;
  phone: string;
  sessionStatus: SessionStatus;
  callbackStatus: "PENDING" | "SENT" | "FAILED";
  verifiedAt: string | null;
  expiresAt: string;
}

// ── Error ──────────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generate a random 4-6 digit numeric code, e.g. "482916" */
function randomCode(): string {
  const length = 4 + Math.floor(Math.random() * 3);
  let code = "";
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
}

/** Thin fetch wrapper — throws HttpError on non-2xx */
async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? text;
    } catch { /* not JSON */ }
    throw new HttpError(res.status, message);
  }
  return res.json() as Promise<T>;
}

// ── API calls ──────────────────────────────────────────────────────────────────

/**
 * POST /sessions — start a new verification session.
 * Throws HttpError on 400 / 401 / 500.
 */
export async function createSession(phone: string): Promise<CreateSessionResponse> {
  return http<CreateSessionResponse>(`${config.verifyMn.baseUrl}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.verifyMn.apiKey}`,
    },
    body: JSON.stringify({ phone, text: randomCode() }),
  });
}

/**
 * GET /sessions/{sessionId} — check current verification status.
 * No auth required.
 */
export async function checkSession(sessionId: string): Promise<GetSessionResponse> {
  return http<GetSessionResponse>(
    `${config.verifyMn.baseUrl}/sessions/${encodeURIComponent(sessionId)}`
  );
}
