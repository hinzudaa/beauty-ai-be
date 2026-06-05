import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User } from "../models/user";
import { OtpSession } from "../models/otpSession";
import { requireAuth } from "../middleware/auth";
import { createSession, checkSession, HttpError } from "../services/verifyMn";

const router = Router();

function signToken(userId: string): string {
  return jwt.sign({ userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

function phoneValid(phone: string): boolean {
  return /^\d{8,16}$/.test(phone);
}

function userPayload(user: { _id: unknown; phone: string; phoneVerified: boolean }) {
  return { id: user._id, phone: user.phone, phoneVerified: user.phoneVerified };
}

async function findOrCreateUser(phone: string) {
  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({ phone, phoneVerified: true });
  } else if (!user.phoneVerified) {
    user.phoneVerified = true;
    await user.save();
  }
  return user;
}

router.post("/start", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };

  if (!phone || !phoneValid(phone)) {
    res.status(400).json({ error: "Утасны дугаар 8–16 оронтой байх ёстой" });
    return;
  }

  if (config.verifyMn.devBypass) {
    const callbackToken = randomUUID();
    const fakeId        = `dev_${Date.now()}`;
    const expires       = new Date(Date.now() + 300_000).toISOString();
    await OtpSession.findOneAndUpdate(
      { phone },
      { sessionId: fakeId, phone, expiresAt: new Date(expires), callbackToken, verified: false },
      { upsert: true, returnDocument: "after" }
    );
    return res.json({
      sessionId:          fakeId,
      smsUri:             "sms:144773?body=000000",
      displayInstruction: "[DEV MODE] Код шаардлагагүй — 3 секундын дараа автоматаар баталгаажна.",
      expiresAt:          expires,
    });
  }

  try {
    const callbackToken = randomUUID();
    const callbackUrl   = config.appBaseUrl
      ? `${config.appBaseUrl}/auth/callback/${callbackToken}`
      : undefined;

    const session = await createSession(phone, callbackUrl);

    await OtpSession.findOneAndUpdate(
      { phone },
      {
        sessionId:     session.sessionId,
        phone,
        expiresAt:     new Date(session.expiresAt),
        callbackToken,
        verified:      false,
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json({
      sessionId:          session.sessionId,
      smsUri:             session.smsUri,
      displayInstruction: session.displayInstruction,
      expiresAt:          session.expiresAt,
    });
  } catch (err: unknown) {
    if (err instanceof HttpError && err.statusCode === 401) {
      res.status(401).json({ error: err.message });
      return;
    }
    const status  = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Алдаа гарлаа";
    res.status(status).json({ error: message });
  }
});

router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };

    if (!sessionId) {
      res.status(400).json({ error: "sessionId шаардлагатай" });
      return;
    }

    const stored = await OtpSession.findOne({ sessionId });
    if (!stored) {
      res.status(202).json({ status: "PENDING" });  // lost race or not yet stored — keep polling
      return;
    }

    if (new Date() > stored.expiresAt) {
      await OtpSession.deleteOne({ sessionId }).catch(() => {});
      res.status(410).json({ error: "OTP хугацаа дууссан. Дахин оролдоно уу." });
      return;
    }

    // Dev bypass
    if (config.verifyMn.devBypass && sessionId.startsWith("dev_")) {
      const claimed = await OtpSession.findOneAndDelete({ sessionId });
      if (!claimed) { res.status(202).json({ status: "PENDING" }); return; }
      const user  = await findOrCreateUser(claimed.phone);
      const token = signToken(String(user._id));
      return res.json({ token, user: userPayload(user) });
    }

    // Already verified by callback — atomic claim to avoid race condition
    if (stored.verified) {
      const claimed = await OtpSession.findOneAndDelete({ sessionId, verified: true });
      if (!claimed) {
        // Another concurrent request already claimed it — return PENDING, next poll will have the token
        res.status(202).json({ status: "PENDING" });
        return;
      }
      const user  = await findOrCreateUser(claimed.phone);
      const token = signToken(String(user._id));
      return res.json({ token, user: userPayload(user) });
    }

    // Not yet verified by callback — check verify.mn directly
    try {
      const status = await checkSession(sessionId);

      if (status.sessionStatus === "EXPIRED") {
        await OtpSession.deleteOne({ sessionId }).catch(() => {});
        res.status(410).json({ error: "OTP хугацаа дууссан. Дахин оролдоно уу." });
        return;
      }

      if (status.sessionStatus !== "VERIFIED") {
        res.status(202).json({ status: "PENDING" });
        return;
      }

      // Atomic claim
      const claimed = await OtpSession.findOneAndDelete({ sessionId });
      if (!claimed) { res.status(202).json({ status: "PENDING" }); return; }
      const user  = await findOrCreateUser(claimed.phone);
      const token = signToken(String(user._id));
      res.json({ token, user: userPayload(user) });

    } catch (err: unknown) {
      if (err instanceof HttpError && err.statusCode === 401) {
        res.status(401).json({ error: "API key алдаатай" });
        return;
      }
      console.error("[verify] checkSession error:", err instanceof Error ? err.message : err);
      res.status(202).json({ status: "PENDING" });
    }

  } catch (err) {
    console.error("[verify] unexpected error:", err instanceof Error ? err.message : err);
    res.status(202).json({ status: "PENDING" });  // never 500 — keep polling
  }
});

router.get("/callback/:callbackToken", async (req: Request, res: Response) => {
  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const stored = await OtpSession.findOne({ callbackToken: req.params.callbackToken });
      if (!stored || stored.verified) return;

      const status = await checkSession(stored.sessionId);
      if (status.sessionStatus === "VERIFIED") {
        await OtpSession.findOneAndUpdate(
          { sessionId: stored.sessionId },
          { verified: true }
        );
      }
    } catch (err) {
      console.error("[callback] error:", err instanceof Error ? err.message : err);
    }
  });
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(userPayload(user));
});

export default router;
