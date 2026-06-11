import { type FeedConfig } from "../../types/feed";

export const feeds: FeedConfig[] = [
  // Backend / Runtime
  {
    source: "Node.js Blog",
    url: "https://nodejs.org/en/feed/blog.xml",
    category: "backend",
    skills: ["nodejs", "javascript", "backend", "runtime"],
  },
  {
    source: "Node.js Vulnerabilities",
    url: "https://nodejs.org/en/feed/vulnerability.xml",
    category: "security",
    skills: ["nodejs", "security", "backend", "runtime"],
  },

  // General developer / engineering
  {
    source: "GitHub Blog",
    url: "https://github.blog/feed/",
    category: "general",
    skills: ["github", "open-source", "developer-tools", "backend"],
  },
  {
    source: "InfoQ Architecture",
    url: "https://feed.infoq.com/architecture",
    category: "backend",
    skills: ["architecture", "backend", "system-design"],
  },

  // DevOps / Cloud / Edge
  {
    source: "Cloudflare Changelog",
    url: "https://developers.cloudflare.com/changelog/rss.xml",
    category: "devops",
    skills: ["cloudflare", "edge", "security", "deployment"],
  },

  // Community signal - chỉ dùng để bắt trend, không coi là nguồn chính thức
  {
    source: "Reddit Node",
    url: "https://www.reddit.com/r/node/.rss",
    category: "backend",
    skills: ["nodejs", "javascript", "backend"],
  },
  {
    source: "Reddit WebDev",
    url: "https://www.reddit.com/r/webdev/.rss",
    category: "frontend",
    skills: ["web", "frontend", "fullstack"],
  },

  // StackOverflow - câu hỏi kỹ thuật mới, không phải news chính thống
  {
    source: "StackOverflow Node.js",
    url: "https://stackoverflow.com/feeds/tag?tagnames=node.js&sort=newest",
    category: "backend",
    skills: ["nodejs", "javascript", "backend"],
  },

  {
    source: "MongoDB Engineering Blog",
    url: "https://www.mongodb.com/company/blog/channel/engineering-blog",
    category: "backend",
    skills: ["mongodb", "database", "distributed-systems"],
  },
  {
    source: "PostgreSQL News",
    url: "https://www.postgresql.org/about/newsarchive/",
    category: "backend",
    skills: ["postgresql", "database", "sql"],
  },
  {
    source: "Redis Blog",
    url: "https://redis.io/blog/",
    category: "backend",
    skills: ["redis", "cache", "database"],
  },
];
