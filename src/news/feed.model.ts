import { Schema, model, type HydratedDocument } from "mongoose";
import { type FeedQuality } from "../types/feed";

export interface IFeed {
  source: string;
  url: string;
  category: string;
  skills: string[];
  quality?: FeedQuality;
  minScore?: number;
  minComments?: number;
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
    quality: { type: String, trim: true },
    minScore: { type: Number, min: 1, max: 100 },
    minComments: { type: Number, min: 0 },
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
