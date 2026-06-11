export interface News {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
  category?: string;
  tags?: string[];
  skills?: string[];
  importanceScore?: number;
  importanceReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateNewsInput = Pick<
  News,
  "title" | "url" | "source" | "publishedAt" | "summary" | "category" | "tags" | "skills" | "importanceScore" | "importanceReason"
>;

export type NewsView = Pick<
  News,
  "title" | "url" | "source" | "publishedAt" | "summary" | "category" | "tags" | "skills" | "importanceScore" | "importanceReason"
> & { _id?: any };
