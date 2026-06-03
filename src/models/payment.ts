import mongoose, { Document, Schema, Model } from "mongoose";

export interface IPayment {
  userId: mongoose.Types.ObjectId;
  phone: string;
  invoiceId: string;
  amount: number;
  status: "pending" | "paid" | "failed";
  type: string;
  createdAt: Date;
  paidAt?: Date;
}

export interface IPaymentDocument extends IPayment, Document {}

const paymentSchema = new Schema<IPaymentDocument>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    phone:     { type: String, required: true },
    invoiceId: { type: String, required: true, unique: true },
    amount:    { type: Number, required: true },
    status:    { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    type:      { type: String, default: "analyze" },
    paidAt:    { type: Date },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const Payment: Model<IPaymentDocument> =
  mongoose.model<IPaymentDocument>("Payment", paymentSchema);
