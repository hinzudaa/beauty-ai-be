/**
 * Tests for verifyMn service
 *
 * Covers:
 *  1. createSession sends correct headers, never logs API key
 *  2. checkSession returns sessionStatus from API
 *  3. HttpError thrown on non-2xx
 *  4. 401 → descriptive error message extracted from JSON body
 */

import { createSession, checkSession, HttpError } from "../services/verifyMn";

// ── Mock global fetch ──────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ── Helpers ────────────────────────────────────────────────────────────────────

function okJson(data: unknown) {
  return { ok: true, json: async () => data, text: async () => "" };
}
function errResponse(status: number, body: unknown = "") {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const FUTURE = new Date(Date.now() + 300_000).toISOString();

function mockSession(sessionId = "sess_abc") {
  return okJson({
    sessionId, phone: "99887766", shortcode: "144773",
    text: "482916", smsUri: "sms:144773?body=482916",
    displayInstruction: "144773 дугаарт 482916 илгээнэ үү",
    expiresAt: FUTURE,
  });
}

function mockStatus(status: "PENDING" | "VERIFIED" | "EXPIRED", sessionId = "sess_abc") {
  return okJson({
    sessionId, phone: "99887766",
    sessionStatus: status,
    callbackStatus: "PENDING",
    verifiedAt: status === "VERIFIED" ? new Date().toISOString() : null,
    expiresAt: FUTURE,
  });
}

beforeEach(() => mockFetch.mockReset());

// ── Tests ──────────────────────────────────────────────────────────────────────

test("createSession POSTs to /sessions with Authorization header", async () => {
  mockFetch.mockResolvedValueOnce(mockSession());

  const res = await createSession("99887766");

  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/sessions");
  expect((init.headers as Record<string, string>)["Authorization"]).toMatch(/^Bearer /);
  expect(res.sessionId).toBe("sess_abc");
  expect(res.smsUri).toMatch(/^sms:/);
});

test("createSession never logs the API key", async () => {
  const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  mockFetch.mockResolvedValueOnce(mockSession());

  await createSession("99887766");

  for (const call of consoleSpy.mock.calls) {
    expect(JSON.stringify(call)).not.toContain("test_api_key");
  }
  consoleSpy.mockRestore();
});

test("checkSession returns sessionStatus", async () => {
  mockFetch.mockResolvedValueOnce(mockStatus("VERIFIED"));

  const res = await checkSession("sess_abc");
  expect(res.sessionStatus).toBe("VERIFIED");
  expect(res.verifiedAt).toBeTruthy();
});

test("checkSession returns PENDING status", async () => {
  mockFetch.mockResolvedValueOnce(mockStatus("PENDING"));

  const res = await checkSession("sess_abc");
  expect(res.sessionStatus).toBe("PENDING");
});

test("HttpError thrown on 500", async () => {
  mockFetch.mockResolvedValueOnce(errResponse(500, "Internal Server Error"));

  await expect(checkSession("sess_abc")).rejects.toBeInstanceOf(HttpError);
});

test("401 error extracts message from JSON body", async () => {
  mockFetch.mockResolvedValueOnce(
    errResponse(401, { message: "API KEY буруу эсвэл хүчингүй болсон." })
  );

  await expect(createSession("99887766")).rejects.toThrow(
    "API KEY буруу эсвэл хүчингүй болсон."
  );
});
