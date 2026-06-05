import mongoose, { Document, Schema, Model } from "mongoose";

export interface IAnalysis {
  userId:      mongoose.Types.ObjectId;
  photoUrl:    string;
  analysis:    Record<string, unknown>;
  looks:       Array<{ name: string; imageUrl: string }>;
  occasion:    string;
  createdAt:   Date;
  generatingAt?: Date;  // set when generation starts, cleared when done — prevents double-gen
}

export interface IAnalysisDocument extends IAnalysis, Document {}

const analysisSchema = new Schema<IAnalysisDocument>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: "User", required: true },
    photoUrl: { type: String, required: true },
    analysis: { type: Schema.Types.Mixed, required: true },
    looks:        { type: [{ name: String, imageUrl: String }], default: [] },
    occasion:     { type: String, default: "casual" },
    generatingAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } }
);

export const Analysis: Model<IAnalysisDocument> =
  mongoose.model<IAnalysisDocument>("Analysis", analysisSchema);
