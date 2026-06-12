export interface News {
  title: string;
  titleEn?: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary?: string;
  summaryEn?: string;
  category?: string;
  tags?: string[];
  skills?: string[];
  commentCount?: number;
  importanceScore?: number;
  importanceReason?: string;
  importanceReasonEn?: string;
  isFallback?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateNewsInput = Pick<
  News,
  | "title"
  | "titleEn"
  | "url"
  | "source"
  | "publishedAt"
  | "summary"
  | "summaryEn"
  | "category"
  | "tags"
  | "skills"
  | "commentCount"
  | "importanceScore"
  | "importanceReason"
  | "importanceReasonEn"
  | "isFallback"
>;

export type NewsView = Pick<
  News,
  | "title"
  | "titleEn"
  | "url"
  | "source"
  | "publishedAt"
  | "summary"
  | "summaryEn"
  | "category"
  | "tags"
  | "skills"
  | "commentCount"
  | "importanceScore"
  | "importanceReason"
  | "importanceReasonEn"
  | "isFallback"
> & { _id?: any };
