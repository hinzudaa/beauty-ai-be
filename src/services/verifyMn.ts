/**
 * verify.mn — Mongolia Mobile-Originated (MO) SMS phone verification
 *
 * Flow:
 *  1. createSession(phone)  → POST /sessions → returns sessionId + displayInstruction + smsUri
 *  2. Show displayInstruction to user; on mobile offer smsUri as tap-to-open link.
 *  3. User sends SMS to shortcode 144773.
 *  4. verify.mn optionally fires a GET callback → our /verify/callback/:sessionId route
 *     (or we fall back to polling every 3 s).
 *  5. checkSession(sessionId) → GET /sessions/{id} → check sessionStatus === "VERIFIED"
 *  6. verifyPhone(phone) wraps the full flow: creates session + polls until VERIFIED or expired.
 */

import { config } from "../config";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionStatus = "PENDING" | "VERIFIED" | "EXPIRED";
export type CallbackStatus = "PENDING" | "SENT" | "FAILED";

export interface CreateSessionResponse {
  sessionId: string;
  phone: string;
  shortcode: "144773";
  text: string;
  smsUri: string;           // sms:144773?body=...
  displayInstruction: string; // Mongolian text to show the user
  expiresAt: string;        // ISO-8601
}

export interface GetSessionResponse {
  sessionId: string;
  phone: string;
  sessionStatus: SessionStatus;
  callbackStatus: CallbackStatus;
  verifiedAt: string | null;
  expiresAt: string;
}

// ── In-memory session registry ─────────────────────────────────────────────────
//    Maps sessionId → userId (or any record you want to link verification to).
//    Replace with DB persistence in production.

const sessionRegistry = new Map<string, { userId: string; resolvers: PromiseFunctions }>();

interface PromiseFunctions {
  resolve: (verified: boolean) => void;
  reject: (err: Error) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generate a random 4-6 digit numeric OTP string, e.g. "482916" */
function randomCode(): string {
  const length = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

/** Thin wrapper around fetch so we can swap it in tests */
async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Try to extract a human-readable message from JSON error bodies
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? text;
    } catch { /* not JSON, use raw text */ }
    throw new HttpError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// ── Core API calls ─────────────────────────────────────────────────────────────

/**
 * POST /sessions — start a new verification session.
 * Throws HttpError on 400/401/500.
 */
export async function createSession(
  phone: string,
  callbackUrl?: string
): Promise<CreateSessionResponse> {
  const code = randomCode();
  const body: Record<string, string> = {
    phone,
    text: code,
  };
  if (callbackUrl) body.callback = callbackUrl;

  return http<CreateSessionResponse>(`${config.verifyMn.baseUrl}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.verifyMn.apiKey}`, // never logged
    },
    body: JSON.stringify(body),
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

// ── Polling-based full flow ────────────────────────────────────────────────────

/**
 * verifyPhone(phone) — creates a session and polls until VERIFIED or expired.
 *
 * Returns true  if the user sent the correct SMS before expiresAt.
 * Returns false if the session expired or an unexpected error occurs.
 *
 * NOTE: In a real web app you'd return `{ sessionId, displayInstruction, smsUri }`
 * to the frontend instead of blocking here. This polling variant is useful for
 * scripts, tests, and CLI flows.
 */
export async function verifyPhone(phone: string): Promise<boolean> {
  let session: CreateSessionResponse;
  try {
    const callbackUrl = config.appBaseUrl
      ? undefined // callback route is registered separately
      : undefined;
    session = await createSession(phone, callbackUrl);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 401) {
      throw new Error("VERIFY_MN_API_KEY is invalid — check your .env");
    }
    throw err;
  }

  const expiresAt = new Date(session.expiresAt).getTime();
  const deadline = expiresAt + 2_000; // 2 s grace

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const status = await checkSession(session.sessionId);
        if (status.sessionStatus === "VERIFIED") {
          clearInterval(interval);
          resolve(true);
          return;
        }
        if (status.sessionStatus === "EXPIRED" || Date.now() > deadline) {
          clearInterval(interval);
          resolve(false);
        }
      } catch {
        // Transient network error — keep polling until deadline
        if (Date.now() > deadline) {
          clearInterval(interval);
          resolve(false);
        }
      }
    }, config.verifyMn.pollIntervalMs);
  });
}

// ── Callback-based flow ────────────────────────────────────────────────────────

/**
 * registerCallbackSession — call this right after createSession() when using
 * the callback route.  Links sessionId → userId so the callback handler can
 * resolve the right waiting promise.
 */
export function registerCallbackSession(
  sessionId: string,
  userId: string,
  onResult: (verified: boolean) => void,
  onError: (err: Error) => void,
  expiresAt: string
): void {
  const timeout = new Date(expiresAt).getTime() - Date.now() + 2_000;

  const timer = setTimeout(() => {
    if (sessionRegistry.has(sessionId)) {
      sessionRegistry.delete(sessionId);
      onResult(false); // expired
    }
  }, timeout);

  sessionRegistry.set(sessionId, {
    userId,
    resolvers: {
      resolve: (v) => { clearTimeout(timer); onResult(v); },
      reject:  (e) => { clearTimeout(timer); onError(e); },
    },
  });
}

/**
 * handleCallback — call this from your GET /verify/callback/:sessionId route.
 * verify.mn fires this as a wake-up signal; we always re-check via GET /sessions.
 * Must return quickly (< 1 s) — respond 200 before awaiting.
 */
export async function handleCallback(sessionId: string): Promise<void> {
  const entry = sessionRegistry.get(sessionId);
  if (!entry) return; // unknown / already resolved

  try {
    const status = await checkSession(sessionId);
    if (status.sessionStatus === "VERIFIED") {
      sessionRegistry.delete(sessionId);
      entry.resolvers.resolve(true);
    } else if (status.sessionStatus === "EXPIRED") {
      sessionRegistry.delete(sessionId);
      entry.resolvers.resolve(false);
    }
    // PENDING → keep waiting (callback may fire again)
  } catch (err) {
    // Don't reject — transient error; let the timeout handle expiry
    console.error("[verifyMn] callback check error:", err instanceof Error ? err.message : err);
  }
}

/** For tests only */
export function _clearRegistry(): void {
  sessionRegistry.clear();
}
