import mongoose, { Document, Schema, Model } from "mongoose";

export interface IUser {
  phone: string;          // digits only, 8–16 chars
  phoneVerified: boolean;
  createdAt: Date;
}

export interface IUserDocument extends IUser, Document {}

const userSchema = new Schema<IUserDocument>(
  {
    phone:         { type: String, required: true, unique: true, match: /^\d{8,16}$/ },
    phoneVerified: { type: Boolean, default: true }, // always true — verified on creation
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const User: Model<IUserDocument> = mongoose.model<IUserDocument>("User", userSchema);
