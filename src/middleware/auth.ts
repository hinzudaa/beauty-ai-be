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
  if (!req.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await User.findById(req.userId);
  if (!user?.phoneVerified) {
    res.status(403).json({ error: "Phone number not verified" });
    return;
  }
  next();
}
