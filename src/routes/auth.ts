/**
 * Phone-only OTP auth
 *
 * POST /auth/start   — send OTP (create verify.mn session)
 * POST /auth/verify  — confirm OTP → find-or-create user → return JWT
 * GET  /auth/me      — return current user (auth required)
 */

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User } from "../models/user";
import { OtpSession } from "../models/otpSession";
import { requireAuth } from "../middleware/auth";
import { createSession, checkSession } from "../services/verifyMn";

const router = Router();

function signToken(userId: string): string {
  return jwt.sign({ userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

function phoneValid(phone: string): boolean {
  return /^\d{8,16}$/.test(phone);
}

// ── POST /auth/start ───────────────────────────────────────────────────────────
// Creates a verify.mn session, stores it, returns display info to the frontend.

router.post("/start", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !phoneValid(phone)) {
    res.status(400).json({ error: "Утасны дугаар 8–16 оронтой байх ёстой" });
    return;
  }

  // ── Dev bypass: skip real SMS, auto-verify in 3 s ───────────────────────────
  if (config.verifyMn.devBypass) {
    const fakeId  = `dev_${Date.now()}`;
    const expires = new Date(Date.now() + 300_000).toISOString();
    await OtpSession.findOneAndUpdate(
      { phone },
      { sessionId: fakeId, phone, expiresAt: new Date(expires) },
      { upsert: true, returnDocument: "after" }
    );
    return res.json({
      sessionId:          fakeId,
      smsUri:             `sms:144773?body=000000`,
      displayInstruction: `[DEV MODE] Код шаардлагагүй — 3 секундын дараа автоматаар баталгаажна.`,
      expiresAt:          expires,
    });
  }

  try {
    const session = await createSession(phone);

    await OtpSession.findOneAndUpdate(
      { phone },
      { sessionId: session.sessionId, phone, expiresAt: new Date(session.expiresAt) },
      { upsert: true, returnDocument: "after" }
    );

    res.json({
      sessionId:          session.sessionId,
      smsUri:             session.smsUri,
      displayInstruction: session.displayInstruction,
      expiresAt:          session.expiresAt,
    });
  } catch (err: unknown) {
    const status  = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Алдаа гарлаа";
    res.status(status).json({ error: message });
  }
});

// ── POST /auth/verify ──────────────────────────────────────────────────────────
// Polls verify.mn; if VERIFIED → find-or-create user → return JWT.

router.post("/verify", async (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };

  if (!sessionId) {
    res.status(400).json({ error: "sessionId шаардлагатай" });
    return;
  }

  const storedSession = await OtpSession.findOne({ sessionId });
  if (!storedSession) {
    res.status(404).json({ error: "Session олдсонгүй эсвэл хугацаа дууссан" });
    return;
  }

  if (new Date() > storedSession.expiresAt) {
    res.status(410).json({ error: "OTP хугацаа дууссан. Дахин оролдоно уу." });
    return;
  }

  // ── Dev bypass: dev_ sessions are always VERIFIED ───────────────────────────
  if (config.verifyMn.devBypass && sessionId.startsWith("dev_")) {
    await OtpSession.deleteOne({ sessionId });
    let user = await User.findOne({ phone: storedSession.phone });
    if (!user) {
      user = await User.create({ phone: storedSession.phone, phoneVerified: true });
    }
    const token = signToken(String(user._id));
    return res.json({
      token,
      user: { id: user._id, phone: user.phone, phoneVerified: user.phoneVerified },
    });
  }

  try {
    const status = await checkSession(sessionId);

    if (status.sessionStatus === "EXPIRED") {
      await OtpSession.deleteOne({ sessionId });
      res.status(410).json({ error: "OTP хугацаа дууссан. Дахин оролдоно уу." });
      return;
    }

    if (status.sessionStatus !== "VERIFIED") {
      // Still pending — tell client to keep polling
      res.status(202).json({ status: "PENDING" });
      return;
    }

    // ── Verified: find-or-create user ──────────────────────────────────────
    await OtpSession.deleteOne({ sessionId });

    let user = await User.findOne({ phone: storedSession.phone });
    if (!user) {
      user = await User.create({ phone: storedSession.phone, phoneVerified: true });
    } else if (!user.phoneVerified) {
      user.phoneVerified = true;
      await user.save();
    }

    const token = signToken(String(user._id));
    res.json({
      token,
      user: { id: user._id, phone: user.phone, phoneVerified: user.phoneVerified },
    });
  } catch (err: unknown) {
    const status  = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Алдаа гарлаа";
    res.status(status).json({ error: message });
  }
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ id: user._id, phone: user.phone, phoneVerified: user.phoneVerified });
});

export default router;
