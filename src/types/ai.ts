export type ArticleCategory =
  | "ai"
  | "backend"
  | "frontend"
  | "devops"
  | "security"
  | "mobile"
  | "career"
  | "other";

export interface AIProcessedResult {
  titleVi: string;
  titleEn: string;
  summaryVi: string;
  summaryEn: string;
  category: ArticleCategory;
  tags: string[];
  skills: string[];
  importanceScore: number;
  importanceReasonVi: string;
  importanceReasonEn: string;
  isFallback?: boolean;
}
