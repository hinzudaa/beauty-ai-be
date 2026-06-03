import mongoose, { Document, Schema, Model } from "mongoose";

export type Feature = "analyze" | "outfit" | "hairstyle" | "full";

export interface IUsageLog {
  userId: mongoose.Types.ObjectId;
  phone: string;
  feature: Feature;
  createdAt: Date;
}

export interface IUsageLogDocument extends IUsageLog, Document {}

const usageLogSchema = new Schema<IUsageLogDocument>(
  {
    userId:  { type: Schema.Types.ObjectId, ref: "User", required: true },
    phone:   { type: String, required: true },
    feature: { type: String, enum: ["analyze", "outfit", "hairstyle", "full"], required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const UsageLog: Model<IUsageLogDocument> =
  mongoose.model<IUsageLogDocument>("UsageLog", usageLogSchema);
