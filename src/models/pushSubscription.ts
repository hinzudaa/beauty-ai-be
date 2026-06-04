import mongoose, { Document, Schema, Model } from "mongoose";

export interface IPushSubscription {
  endpoint:  string;
  keys: {
    p256dh: string;
    auth:   string;
  };
  createdAt: Date;
}

export interface IPushSubscriptionDocument extends IPushSubscription, Document {}

const pushSchema = new Schema<IPushSubscriptionDocument>(
  {
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const PushSubscription: Model<IPushSubscriptionDocument> =
  mongoose.model<IPushSubscriptionDocument>("PushSubscription", pushSchema);
