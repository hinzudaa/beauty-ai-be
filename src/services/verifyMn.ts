import { config } from "../config";

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

export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function randomCode(): string {
  const length = 4 + Math.floor(Math.random() * 3);
  let code = "";
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
}

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

export async function createSession(
  phone: string,
  callbackUrl?: string
): Promise<CreateSessionResponse> {
  const body: Record<string, string> = { phone, text: randomCode() };
  if (callbackUrl) body.callback = callbackUrl;

  return http<CreateSessionResponse>(`${config.verifyMn.baseUrl}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.verifyMn.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

export async function checkSession(sessionId: string): Promise<GetSessionResponse> {
  return http<GetSessionResponse>(
    `${config.verifyMn.baseUrl}/sessions/${encodeURIComponent(sessionId)}`
  );
}

export async function verifyPhone(phone: string): Promise<boolean> {
  let session: CreateSessionResponse;
  try {
    session = await createSession(phone);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 401) {
      throw new Error("VERIFY_MN_API_KEY is invalid — check your .env");
    }
    throw err;
  }

  const deadline = new Date(session.expiresAt).getTime() + 2_000;

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
        if (Date.now() > deadline) {
          clearInterval(interval);
          resolve(false);
        }
      }
    }, config.verifyMn.pollIntervalMs);
  });
}

const callbackRegistry = new Map<string, {
  resolve: (verified: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function registerCallbackSession(
  sessionId: string,
  expiresAt: string,
  onResult: (verified: boolean) => void
): void {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now()) + 2_000;

  const timer = setTimeout(() => {
    callbackRegistry.delete(sessionId);
    onResult(false);
  }, remaining);

  callbackRegistry.set(sessionId, {
    resolve: (verified) => {
      clearTimeout(timer);
      callbackRegistry.delete(sessionId);
      onResult(verified);
    },
    timer,
  });
}

export async function handleCallback(sessionId: string): Promise<void> {
  const entry = callbackRegistry.get(sessionId);
  if (!entry) return;

  try {
    const status = await checkSession(sessionId);
    if (status.sessionStatus === "VERIFIED") entry.resolve(true);
    else if (status.sessionStatus === "EXPIRED") entry.resolve(false);
  } catch (err) {
    console.error("[verifyMn] callback check error:", err instanceof Error ? err.message : err);
  }
}

export function _clearRegistry(): void {
  for (const [, entry] of callbackRegistry) clearTimeout(entry.timer);
  callbackRegistry.clear();
}
