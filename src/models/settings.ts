import mongoose, { Document, Schema, Model } from "mongoose";

export interface ISetting {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface ISettingDocument extends ISetting, Document {}

const settingSchema = new Schema<ISettingDocument>(
  { key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } }
);

export const Setting: Model<ISettingDocument> =
  mongoose.model<ISettingDocument>("Setting", settingSchema);

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const doc = await Setting.findOne({ key }).lean();
  return doc ? (doc.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
}
