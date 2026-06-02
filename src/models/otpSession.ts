import mongoose, { Document, Schema, Model } from "mongoose";

export interface IOtpSession {
  sessionId: string;   // verify.mn session id
  phone: string;
  expiresAt: Date;
}

export interface IOtpSessionDocument extends IOtpSession, Document {}

const otpSessionSchema = new Schema<IOtpSessionDocument>({
  sessionId: { type: String, required: true, unique: true },
  phone:     { type: String, required: true },
  expiresAt: { type: Date,   required: true },
});

// Auto-remove expired docs
otpSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpSession: Model<IOtpSessionDocument> =
  mongoose.model<IOtpSessionDocument>("OtpSession", otpSessionSchema);
