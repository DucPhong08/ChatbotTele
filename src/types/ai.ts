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
  summaryVi: string;
  category: ArticleCategory;
  tags: string[];
  skills: string[];
  importanceScore: number;
  importanceReason: string;
}
