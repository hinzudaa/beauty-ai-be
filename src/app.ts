import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    const allowed = process.env.ALLOWED_ORIGIN;
    if (allowed && origin === allowed) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

app.use("/auth", authRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

export default app;
