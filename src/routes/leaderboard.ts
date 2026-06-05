import { Router, Request, Response } from "express";
import { User } from "../models/user";

const router = Router();

/* ── GET /leaderboard ─────────────────────────────────────────
   Public endpoint — top 100 users by lookScore (0–100 decimal)
────────────────────────────────────────────────────────────── */
router.get("/", async (_req: Request, res: Response) => {
  const users = await User.find({ lookScore: { $ne: null }, username: { $ne: null } })
    .sort({ lookScore: -1 })
    .limit(100)
    .select("username lookScore avatarUrl createdAt")
    .lean();

  const board = users.map((u, idx) => ({
    rank:      idx + 1,
    username:  u.username,
    lookScore: Number((u.lookScore ?? 0).toFixed(1)),
    avatarUrl: u.avatarUrl ?? null,
  }));

  res.json({ data: board, total: board.length });
});

export default router;
