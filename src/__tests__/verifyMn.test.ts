/**
 * Tests for verifyMn service
 *
 * Covers:
 *  1. PENDING → VERIFIED: verifyPhone returns true
 *  2. EXPIRED timeout:    verifyPhone returns false
 *  3. 401 bad key:        verifyPhone throws descriptive error
 */

import {
  verifyPhone,
  createSession,
  checkSession,
  _clearRegistry,
  HttpError,
} from "../services/verifyMn";

// ── Mock global fetch ──────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockCreateSession(overrides: Partial<{
  sessionId: string;
  expiresAt: string;
}> = {}) {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 300_000).toISOString();
  return {
    ok: true,
    json: async () => ({
      sessionId:          overrides.sessionId ?? "sess_abc",
      phone:              "88001234",
      shortcode:          "144773",
      text:               "482916",
      smsUri:             "sms:144773?body=482916",
      displayInstruction: "144773 дугаарт 482916 илгээнэ үү",
      expiresAt,
    }),
  };
}

function mockCheckSession(status: "PENDING" | "VERIFIED" | "EXPIRED") {
  return {
    ok: true,
    json: async () => ({
      sessionId:      "sess_abc",
      phone:          "88001234",
      sessionStatus:  status,
      callbackStatus: "PENDING",
      verifiedAt:     status === "VERIFIED" ? new Date().toISOString() : null,
      expiresAt:      new Date(Date.now() + 300_000).toISOString(),
    }),
  };
}

function mockError(statusCode: number, body = "") {
  return { ok: false, status: statusCode, text: async () => body };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
  _clearRegistry();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// 1. PENDING → VERIFIED ────────────────────────────────────────────────────────

test("verifyPhone returns true when session transitions PENDING → VERIFIED", async () => {
  // First fetch: POST /sessions
  mockFetch.mockResolvedValueOnce(mockCreateSession());
  // Second fetch: GET /sessions/sess_abc → PENDING
  mockFetch.mockResolvedValueOnce(mockCheckSession("PENDING"));
  // Third fetch: GET /sessions/sess_abc → VERIFIED
  mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED"));

  const promise = verifyPhone("88001234");

  // Advance past first poll interval (3 s) → gets PENDING, keeps going
  await jest.advanceTimersByTimeAsync(3_000);
  // Advance past second poll interval → gets VERIFIED
  await jest.advanceTimersByTimeAsync(3_000);

  const result = await promise;
  expect(result).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

// 2. EXPIRED timeout ───────────────────────────────────────────────────────────

test("verifyPhone returns false when session expires", async () => {
  // Session expires in ~50 ms from now (well within test control)
  const expiresAt = new Date(Date.now() + 50).toISOString();
  mockFetch.mockResolvedValueOnce(mockCreateSession({ expiresAt }));
  // Poll returns EXPIRED
  mockFetch.mockResolvedValue(mockCheckSession("EXPIRED"));

  const promise = verifyPhone("88001234");

  await jest.advanceTimersByTimeAsync(3_100);

  const result = await promise;
  expect(result).toBe(false);
});

// 3. 401 bad key ───────────────────────────────────────────────────────────────

test("verifyPhone throws a descriptive error on 401", async () => {
  mockFetch.mockResolvedValueOnce(mockError(401, "Unauthorized"));

  await expect(verifyPhone("88001234")).rejects.toThrow(
    "VERIFY_MN_API_KEY is invalid"
  );
});

// 4. createSession passes correct headers ──────────────────────────────────────

test("createSession sends Authorization header and never logs the key", async () => {
  const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  mockFetch.mockResolvedValueOnce(mockCreateSession());

  await createSession("88001234");

  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/sessions");
  const headers = init.headers as Record<string, string>;
  expect(headers["Authorization"]).toMatch(/^Bearer /);
  // The key itself must not appear in any console.log call
  for (const call of consoleSpy.mock.calls) {
    expect(JSON.stringify(call)).not.toContain("test_api_key");
  }
  consoleSpy.mockRestore();
});

// 5. checkSession parses response correctly ────────────────────────────────────

test("checkSession returns sessionStatus from API", async () => {
  mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED"));

  const result = await checkSession("sess_abc");
  expect(result.sessionStatus).toBe("VERIFIED");
  expect(result.verifiedAt).toBeTruthy();
});

// 6. HttpError on non-2xx ──────────────────────────────────────────────────────

test("checkSession throws HttpError on 500", async () => {
  mockFetch.mockResolvedValueOnce(mockError(500, "Internal Server Error"));

  await expect(checkSession("sess_abc")).rejects.toBeInstanceOf(HttpError);
});
