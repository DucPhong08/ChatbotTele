import { Schema, model, type HydratedDocument } from "mongoose";

export interface IFeed {
  source: string;
  url: string;
  category: string;
  skills: string[];
  isActive: boolean;
  submittedBy?: string;
  approvedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type FeedDocument = HydratedDocument<IFeed>;

const feedSchema = new Schema<IFeed>(
  {
    source: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    category: { type: String, default: "general", trim: true },
    skills: { type: [String], default: [] },
    isActive: { type: Boolean, default: false },
    submittedBy: { type: String, trim: true },
    approvedBy: { type: String, trim: true },
  },
  {
    timestamps: true,
  },
);

feedSchema.index({ url: 1 }, { unique: true });

export const FeedModel = model<IFeed>("Feed", feedSchema);
