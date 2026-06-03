import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User } from "../models/user";

export interface AuthPayload {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload;
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function requireVerifiedPhone(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const user = await User.findById(req.userId);
  if (!user?.phoneVerified) { res.status(403).json({ error: "Phone number not verified" }); return; }
  next();
}

/** Gate AI features behind free trial OR active subscription */
export async function requireAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const user = await User.findById(req.userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Free trial: first-ever AI feature use
  if (!user.freeTrialUsed) {
    req.isFreeTrial = true;
    return next();
  }

  const sub = user.subscription;
  const now = new Date();

  // No subscription or expired
  if (!sub || sub.status !== "active" || sub.expiresAt < now) {
    res.status(402).json({
      error: "needsSubscription",
      message: "Сар бүрийн захиалга шаардлагатай",
      freeTrialUsed: true,
    });
    return;
  }

  // Auto-reset monthly counter when period rolls over
  if (now >= sub.usageResetAt) {
    const nextReset = new Date(sub.usageResetAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await User.findByIdAndUpdate(req.userId, {
      "subscription.monthlyUsage": 0,
      "subscription.usageResetAt": nextReset,
    });
    sub.monthlyUsage = 0;
  }

  // Monthly usage limit
  const limit = sub.plan === "pro" ? 40 : 20;
  if (sub.monthlyUsage >= limit) {
    res.status(402).json({
      error: "usageLimitReached",
      message: `Сарын ${limit} ашиглалтын хязгаарт хүрлээ`,
      plan: sub.plan,
      limit,
      used: sub.monthlyUsage,
    });
    return;
  }

  req.isFreeTrial = false;
  next();
}

/** Pro-only feature gate */
export async function requirePro(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const user = await User.findById(req.userId);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const sub = user.subscription;
  const now = new Date();

  if (!sub || sub.plan !== "pro" || sub.status !== "active" || sub.expiresAt < now) {
    res.status(402).json({
      error: "proRequired",
      message: "Энэ боломж Pro захиалгад зориулагдсан",
    });
    return;
  }

  next();
}
