import express from "express";
import cors from "cors";
import authRouter    from "./routes/auth";
import analyzeRouter from "./routes/analyze";
import paymentRouter from "./routes/payment";
import adminRouter   from "./routes/admin";
import profileRouter from "./routes/profile";
import chatRouter    from "./routes/chat";
import pricesRouter  from "./routes/prices";
import uploadRouter      from "./routes/upload";
import leaderboardRouter from "./routes/leaderboard";

const app = express();

const ALLOWED_ORIGINS = [
  // Local development
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  // DigitalOcean default URL (used while DNS is being configured)
  /^https:\/\/.*\.ondigitalocean\.app$/,
  // Production custom domain
  "https://looka.beauty",
  "https://www.looka.beauty",
  "https://admin.looka.beauty",
  // Vercel preview/production URLs
  /^https:\/\/.*\.vercel\.app$/,
  // Extra origin from env (optional override)
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    const ok = ALLOWED_ORIGINS.some((o) =>
      typeof o === "string" ? o === origin : o.test(origin)
    );
    if (ok) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));

app.use("/auth",    authRouter);
app.use("/analyze", analyzeRouter);
app.use("/payment", paymentRouter);
app.use("/admin",   adminRouter);
app.use("/profile", profileRouter);
app.use("/chat",    chatRouter);
app.use("/prices",  pricesRouter);
app.use("/upload",      uploadRouter);
app.use("/leaderboard", leaderboardRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

export default app;
