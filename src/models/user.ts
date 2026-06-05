import mongoose, { Document, Schema, Model } from "mongoose";

export interface ISubscription {
  plan: "basic" | "standard" | "pro";
  status: "active" | "expired";
  startedAt: Date;
  expiresAt: Date;
  monthlyUsage: number;
  usageResetAt: Date;
}

export interface IUser {
  phone: string;
  phoneVerified: boolean;
  freeTrialUsed: boolean;
  subscription?: ISubscription;
  createdAt: Date;
  username?: string;
  usernameChangedAt?: Date;
  lookScore?: number;          // 0–100, decimal — best analysis score × 10
  avatarUrl?: string;          // latest generated look for leaderboard
  showOnLeaderboard?: boolean; // explicit consent to appear on leaderboard
}

export interface IUserDocument extends IUser, Document {}

const subscriptionSchema = new Schema<ISubscription>(
  {
    plan:         { type: String, enum: ["basic", "standard", "pro"], required: true },
    status:       { type: String, enum: ["active", "expired"], default: "active" },
    startedAt:    { type: Date, required: true },
    expiresAt:    { type: Date, required: true },
    monthlyUsage: { type: Number, default: 0 },
    usageResetAt: { type: Date, required: true },
  },
  { _id: false }
);

const userSchema = new Schema<IUserDocument>(
  {
    phone:              { type: String, required: true, unique: true, match: /^\d{8,16}$/ },
    phoneVerified:      { type: Boolean, default: true },
    freeTrialUsed:      { type: Boolean, default: false },
    subscription:       { type: subscriptionSchema },
    username:            { type: String, unique: true, sparse: true, minlength: 3, maxlength: 20 },
    usernameChangedAt:   { type: Date },
    lookScore:           { type: Number, min: 0, max: 100, default: null },
    avatarUrl:           { type: String },
    showOnLeaderboard:   { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const User: Model<IUserDocument> = mongoose.model<IUserDocument>("User", userSchema);
