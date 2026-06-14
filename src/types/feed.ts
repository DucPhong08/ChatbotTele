export type FeedQuality = "official" | "engineering" | "discussion" | "low-signal";

export type FeedConfig = {
  source: string;
  url: string;
  category: string;
  skills: string[];
  quality?: FeedQuality;
  minScore?: number;
  minComments?: number;
  sourceBoost?: number;
};
