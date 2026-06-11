import { type FeedConfig } from "../../types/feed";

export const feeds: FeedConfig[] = [
  // Core developer blogs
  {
    source: "Hacker News",
    url: "https://hnrss.org/frontpage?points=100",
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

  // Frontend / UX / UI / Weekly Newsletters
  {
    source: "Nielsen Norman Group",
    url: "https://www.nngroup.com/feed/rss",
    category: "other",
    skills: ["ux", "ui", "product-design", "frontend"],
  },
  {
    source: "Front-End Front",
    url: "https://frontendfront.com/feed.xml",
    category: "frontend",
    skills: ["frontend", "web", "css", "html", "javascript"],
  },
  {
    source: "CSS-Tricks",
    url: "https://css-tricks.com/feed/",
    category: "frontend",
    skills: ["css", "frontend", "web", "design"],
  },
  {
    source: "CSS Weekly",
    url: "https://css-weekly.com/feed/",
    category: "frontend",
    skills: ["css", "frontend", "web", "design"],
  },
  {
    source: "JavaScript Weekly",
    url: "https://javascriptweekly.com/rss",
    category: "frontend",
    skills: ["javascript", "typescript", "web"],
  },
  {
    source: "Node Weekly",
    url: "https://nodeweekly.com/rss",
    category: "backend",
    skills: ["nodejs", "javascript", "backend"],
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
    url: "https://www.reddit.com/r/node/hot/.rss",
    category: "backend",
    skills: ["nodejs", "javascript", "backend"],
  },
  {
    source: "Reddit WebDev",
    url: "https://www.reddit.com/r/webdev/hot/.rss",
    category: "frontend",
    skills: ["web", "frontend", "fullstack"],
  },
  {
    source: "Reddit Backend",
    url: "https://www.reddit.com/r/Backend/hot/.rss",
    category: "backend",
    skills: ["backend", "architecture", "database", "system-design"],
  },
  {
    source: "Reddit RemoteITJobs",
    url: "https://www.reddit.com/r/RemoteITJobs/hot/.rss",
    category: "career",
    skills: ["career", "remote", "jobs", "it"],
  },
  {
    source: "Reddit linux4noobs",
    url: "https://www.reddit.com/r/linux4noobs/hot/.rss",
    category: "devops",
    skills: ["linux", "bash", "sysadmin", "devops"],
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
