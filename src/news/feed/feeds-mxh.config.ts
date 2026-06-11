import { type FeedConfig } from "../../types/feed";
import { env } from "../../config/env";

const rsshub = env.rsshubUrl.replace(/\/$/, "");

export const feeds: FeedConfig[] = [
  {
    source: "Facebook Meta",
    url: `${rsshub}/facebook/page/Meta`,
    category: "general",
    skills: ["meta", "facebook", "social-media"],
  },
  {
    source: "Facebook Mark Zuckerberg",
    url: `${rsshub}/facebook/page/zuck`,
    category: "general",
    skills: ["meta", "threads", "personal-blog"],
  },
  {
    source: "Facebook Google",
    url: `${rsshub}/facebook/page/Google`,
    category: "general",
    skills: ["google", "android", "tech-news"],
  },
  {
    source: "Facebook Microsoft",
    url: `${rsshub}/facebook/page/Microsoft`,
    category: "general",
    skills: ["microsoft", "windows", "azure"],
  },
  {
    source: "Facebook OpenAI",
    url: `${rsshub}/facebook/page/OpenAI`,
    category: "ai",
    skills: ["openai", "ai", "llm", "chatgpt"],
  },
];
