import { config } from "./config";
import { connectDB } from "./db";
import app from "./app";

async function main() {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`[server] beauty-ai-be running on port ${config.port} (${config.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error("[server] startup error:", err);
  process.exit(1);
});
