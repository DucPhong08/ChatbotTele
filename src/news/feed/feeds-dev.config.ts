import { type FeedConfig } from "../../types/feed";

export const feeds: FeedConfig[] = [
  {
    source: "Hacker News",
    url: "https://hnrss.org/frontpage",
    category: "general",
    skills: ["startup", "engineering", "programming", "ai"],
  },
  {
    source: "Dev.to",
    url: "https://dev.to/feed",
    category: "general",
    skills: ["javascript", "typescript", "web", "backend"],
  },
  {
    source: "GitHub Blog",
    url: "https://github.blog/feed/",
    category: "general",
    skills: ["github", "open-source", "developer-tools", "ai"],
  },

  // Bỏ React Blog vì RSS hiện tại lỗi 404
  // {
  //   source: "React Blog",
  //   url: "https://react.dev/blog/rss.xml",
  //   category: "frontend",
  //   skills: ["react", "frontend", "javascript"],
  // },

  // Bỏ URL cũ này vì lỗi 404
  // {
  //   source: "Vercel Blog",
  //   url: "https://vercel.com/blog/rss",
  //   category: "frontend",
  //   skills: ["nextjs", "frontend", "deployment", "web"],
  // },

  {
    source: "Cloudflare Changelog",
    url: "https://developers.cloudflare.com/changelog/rss.xml",
    category: "devops",
    skills: ["cloudflare", "edge", "security", "deployment"],
  },
  {
    source: "AWS What's New",
    url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/",
    category: "devops",
    skills: ["aws", "cloud", "infrastructure"],
  },
  {
    source: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    category: "ai",
    skills: ["ai", "llm", "agents", "api"],
  },
  {
    source: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml",
    category: "ai",
    skills: ["ai", "machine-learning", "open-source-models"],
  },

  // Có thể bật lại
  {
    source: "Node.js Blog",
    url: "https://nodejs.org/en/feed/blog.xml",
    category: "backend",
    skills: ["nodejs", "javascript", "backend", "runtime"],
  },
  {
    source: "JavaScript Weekly",
    url: "https://javascriptweekly.com/rss",
    category: "frontend",
    skills: ["javascript", "typescript", "web"],
  },
];
