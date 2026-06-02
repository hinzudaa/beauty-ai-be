/**
 * Phone verification routes
 *
 * POST /verify/start              — create a verify.mn session (auth required)
 * GET  /verify/callback/:sessionId — verify.mn fires this when user sends SMS
 * GET  /verify/status/:sessionId  — client polls this while waiting
 */

import { Router, Request, Response } from "express";
import { config } from "../config";
import { User } from "../models/user";
import { requireAuth } from "../middleware/auth";
import {
  createSession,
  checkSession,
  handleCallback,
  registerCallbackSession,
} from "../services/verifyMn";

const router = Router();

// ── POST /verify/start ─────────────────────────────────────────────────────────

router.post("/start", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.phoneVerified) {
    res.status(400).json({ error: "Phone already verified" });
    return;
  }

  try {
    const session = await createSession(user.phone);

    if (config.appBaseUrl) {
      registerCallbackSession(
        session.sessionId,
        String(user._id),
        async (verified) => {
          if (verified) {
            await User.findByIdAndUpdate(user._id, { phoneVerified: true });
          }
        },
        (err) => { console.error("[verify] callback error:", err.message); },
        session.expiresAt
      );
    }

    res.json({
      sessionId:          session.sessionId,
      smsUri:             session.smsUri,
      displayInstruction: session.displayInstruction,
      expiresAt:          session.expiresAt,
    });
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Verification error";
    res.status(status).json({ error: message });
  }
});

// ── GET /verify/callback/:sessionId — verify.mn wake-up call ──────────────────
//   Must respond 200 fast (< 1 s). Actual status check happens inside handleCallback.

router.get("/callback/:sessionId", async (req: Request, res: Response) => {
  res.sendStatus(200); // respond immediately — verify.mn has 3 s timeout

  handleCallback(String(req.params.sessionId)).catch((err) => {
    console.error("[verify] callback handler error:", err);
  });
});

// ── GET /verify/status/:sessionId — client polling endpoint ───────────────────

router.get("/status/:sessionId", requireAuth, async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);

  try {
    const session = await checkSession(sessionId);

    if (session.sessionStatus === "VERIFIED") {
      await User.findByIdAndUpdate(req.userId, { phoneVerified: true });
    }

    res.json({ sessionStatus: session.sessionStatus, verifiedAt: session.verifiedAt });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "Status check error";
    res.status(statusCode).json({ error: message });
  }
});

export default router;
