import mongoose from "mongoose";
import { config } from "./config";

export async function connectDB(): Promise<void> {
  mongoose.connection.on("connected", () =>
    console.log("[db] MongoDB connected")
  );
  mongoose.connection.on("error", (err) =>
    console.error("[db] MongoDB error:", err)
  );
  mongoose.connection.on("disconnected", () =>
    console.warn("[db] MongoDB disconnected")
  );

  await mongoose.connect(config.mongoUri);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
