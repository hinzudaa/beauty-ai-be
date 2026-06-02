/**
 * Auth OTP route integration tests — uses mongodb-memory-server via dbSetup.ts
 *
 * verify.mn calls are mocked so tests run offline.
 */

import request from "supertest";
import app from "../app";

// ── Mock global fetch (used by verifyMn service) ──────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data, text: async () => "" };
}
function errResponse(status: number) {
  return { ok: false, status, json: async () => ({ error: "err" }), text: async () => "err" };
}

const FUTURE = new Date(Date.now() + 300_000).toISOString();

function mockCreateSession(sessionId = "sess_123") {
  return okJson({
    sessionId, phone: "99887766", shortcode: "144773",
    text: "482916", smsUri: "sms:144773?body=482916",
    displayInstruction: "144773 дугаарт 482916 илгээнэ үү",
    expiresAt: FUTURE,
  });
}

function mockCheckSession(status: "PENDING" | "VERIFIED" | "EXPIRED", sessionId = "sess_123") {
  return okJson({
    sessionId, phone: "99887766",
    sessionStatus: status,
    callbackStatus: "PENDING",
    verifiedAt: status === "VERIFIED" ? new Date().toISOString() : null,
    expiresAt: FUTURE,
  });
}

beforeEach(() => mockFetch.mockReset());

// ── POST /auth/start ──────────────────────────────────────────────────────────

describe("POST /auth/start", () => {
  it("returns session info on valid phone", async () => {
    mockFetch.mockResolvedValueOnce(mockCreateSession());

    const res = await request(app).post("/auth/start").send({ phone: "99887766" });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("sess_123");
    expect(res.body.smsUri).toMatch(/^sms:/);
    expect(res.body.displayInstruction).toBeTruthy();
  });

  it("rejects invalid phone", async () => {
    const res = await request(app).post("/auth/start").send({ phone: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 401 on bad API key", async () => {
    mockFetch.mockResolvedValueOnce(errResponse(401));
    const res = await request(app).post("/auth/start").send({ phone: "99887766" });
    expect(res.status).toBe(401);
  });
});

// ── POST /auth/verify ─────────────────────────────────────────────────────────

describe("POST /auth/verify", () => {
  beforeEach(async () => {
    // Seed an OTP session via /auth/start
    mockFetch.mockResolvedValueOnce(mockCreateSession());
    await request(app).post("/auth/start").send({ phone: "99887766" });
  });

  it("returns 202 while still PENDING", async () => {
    mockFetch.mockResolvedValueOnce(mockCheckSession("PENDING"));
    const res = await request(app).post("/auth/verify").send({ sessionId: "sess_123" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PENDING");
  });

  it("returns JWT + user when VERIFIED (auto-registers new user)", async () => {
    mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED"));
    const res = await request(app).post("/auth/verify").send({ sessionId: "sess_123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.phone).toBe("99887766");
    expect(res.body.user.phoneVerified).toBe(true);
  });

  it("returns JWT + user when VERIFIED (logs in existing user)", async () => {
    // First verification creates the user
    mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED"));
    await request(app).post("/auth/verify").send({ sessionId: "sess_123" });

    // Second round — same phone
    mockFetch.mockResolvedValueOnce(mockCreateSession("sess_456"));
    await request(app).post("/auth/start").send({ phone: "99887766" });
    mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED", "sess_456"));
    const res = await request(app).post("/auth/verify").send({ sessionId: "sess_456" });
    expect(res.status).toBe(200);
    expect(res.body.user.phone).toBe("99887766");
  });

  it("returns 410 when session EXPIRED", async () => {
    mockFetch.mockResolvedValueOnce(mockCheckSession("EXPIRED"));
    const res = await request(app).post("/auth/verify").send({ sessionId: "sess_123" });
    expect(res.status).toBe(410);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await request(app).post("/auth/verify").send({ sessionId: "unknown" });
    expect(res.status).toBe(404);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe("GET /auth/me", () => {
  it("returns user for valid token", async () => {
    mockFetch.mockResolvedValueOnce(mockCreateSession());
    await request(app).post("/auth/start").send({ phone: "99887766" });
    mockFetch.mockResolvedValueOnce(mockCheckSession("VERIFIED"));
    const login = await request(app).post("/auth/verify").send({ sessionId: "sess_123" });

    const res = await request(app).get("/auth/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("99887766");
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});
