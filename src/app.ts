import express, { Request, Response } from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import { handleCallback } from "./services/verifyMn";

const app = express();

// Allow requests from the Next.js frontend (and any localhost port in dev)
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman) or any localhost/127 origin
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    // In production, set ALLOWED_ORIGIN env var
    const allowed = process.env.ALLOWED_ORIGIN;
    if (allowed && origin === allowed) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/auth", authRouter);

app.get("/verify/callback/:sessionId", (req: Request, res: Response) => {
  res.sendStatus(200);
  handleCallback(String(req.params.sessionId)).catch((err) => {
    console.error("[callback] error:", err);
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
