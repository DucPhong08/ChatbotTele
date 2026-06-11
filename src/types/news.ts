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
  importanceScore?: number;
  importanceReason?: string;
  importanceReasonEn?: string;
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
  | "importanceScore"
  | "importanceReason"
  | "importanceReasonEn"
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
  | "importanceScore"
  | "importanceReason"
  | "importanceReasonEn"
> & { _id?: any };
