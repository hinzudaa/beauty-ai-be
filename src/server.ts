import { config } from "./config";
import { connectDB } from "./db";
import app from "./app";
import { Payment } from "./models/payment";

/** Delete pending payments that have been waiting more than 20 minutes */
async function cleanExpiredPayments() {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000);
  const result = await Payment.deleteMany({
    status:    "pending",
    createdAt: { $lt: cutoff },
  });
  if (result.deletedCount > 0) {
    console.log(`[cleanup] Deleted ${result.deletedCount} expired pending payment(s)`);
  }
}

async function main() {
  await connectDB();

  // Run cleanup immediately on startup, then every 5 minutes
  cleanExpiredPayments().catch(() => {});
  setInterval(() => cleanExpiredPayments().catch(() => {}), 5 * 60 * 1000);

  app.listen(config.port, () => {
    console.log(`[server] beauty-ai-be running on port ${config.port} (${config.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error("[server] startup error:", err);
  process.exit(1);
});
