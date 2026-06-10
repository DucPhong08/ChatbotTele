import { Schema, model, type HydratedDocument } from "mongoose";

export interface News {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
  category?: string;
  tags?: string[];
  importanceScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewsDocument = HydratedDocument<News>;

const newsSchema = new Schema<News>(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    publishedAt: { type: Date, required: true },
    summary: { type: String, trim: true },
    category: { type: String, trim: true },
    tags: { type: [String], default: [] },
    importanceScore: { type: Number, default: 50 },
  },
  {
    timestamps: true,
  },
);

newsSchema.index({ url: 1 }, { unique: true });
newsSchema.index({ publishedAt: -1 });
newsSchema.index({ source: 1 });

export const NewsModel = model<News>("News", newsSchema);
