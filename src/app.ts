import express from "express";
import cors from "cors";
import authRouter    from "./routes/auth";
import analyzeRouter from "./routes/analyze";
import paymentRouter from "./routes/payment";
import adminRouter   from "./routes/admin";
import profileRouter from "./routes/profile";
import chatRouter    from "./routes/chat";
import pricesRouter  from "./routes/prices";
import uploadRouter  from "./routes/upload";

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

app.use(express.json({ limit: "10mb" }));

app.use("/auth",    authRouter);
app.use("/analyze", analyzeRouter);
app.use("/payment", paymentRouter);
app.use("/admin",   adminRouter);
app.use("/profile", profileRouter);
app.use("/chat",    chatRouter);
app.use("/prices",  pricesRouter);
app.use("/upload",  uploadRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

export default app;
