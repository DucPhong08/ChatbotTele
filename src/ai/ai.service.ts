import { env, type AiProvider } from "../config/env";
import { type AIProcessedResult, type ArticleCategory } from "../types/ai";
import { type NewsView } from "../types/news";
import { TECH_NEWS_PROMPT, SUMMARIZE_PROMPT, PARSE_PREFERENCES_PROMPT } from "./prompts";
import { hasVietnamese } from "../news/news.formatter";

export interface DetailedSummaryResult {
  title: string;
  summaryPoints: string[];
  whyItMatters: string;
  uncertainty: string;
  actions: string[];
  readabilityScore: number;
  topics: string[];
}

const CATEGORY_OPTIONS = [
  "ai",
  "backend",
  "frontend",
  "devops",
  "security",
  "mobile",
  "career",
  "other",
] as const;

type InferredMetadata = {
  category: ArticleCategory;
  tags: string[];
  importanceScore: number;
  importanceReason: string;
};

type KeywordRule = {
  category: ArticleCategory;
  tag: string;
  keywords: string[];
  score: number;
};

type GoogleTranslateResponse = Array<Array<[string, ...unknown[]]>>;

type ArticleProcessInput = {
  title: string;
  content: string;
  source: string;
  url: string;
  publishedAt: Date;
  commentCount?: number;
};

const AI_RETRY_DELAYS_MS = [500, 1500];

// Phương án dự phòng cuối cùng: OpenRouter free model (không cần cấu hình)
const FREE_FALLBACK_MODEL = "google/gemini-2.5-flash:free";
const FREE_FALLBACK_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const FREE_FALLBACK_HEADERS = {
  "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
  "X-Title": "Chatbot News Telegram",
};

const SOURCE_SCORES: Record<string, number> = {
  "OpenAI Blog": 18,
  "GitHub Blog": 16,
  "React Blog": 16,
  "Cloudflare Changelog": 16,
  "AWS What's New": 15,
  "Hugging Face Blog": 15,
  "Hacker News": 12,
  "Dev.to": 9,
};

const KEYWORD_RULES: KeywordRule[] = [
  {
    category: "security",
    tag: "security",
    keywords: ["security", "vulnerability", "cve", "exploit", "zero-day", "patch", "breach"],
    score: 14,
  },
  {
    category: "ai",
    tag: "ai",
    keywords: ["ai", "llm", "agent", "model", "inference", "fine-tuning", "rag", "embedding"],
    score: 10,
  },
  {
    category: "backend",
    tag: "backend",
    keywords: [
      "node.js",
      "nodejs",
      "api",
      "database",
      "postgres",
      "mongodb",
      "redis",
      "runtime",
      "queue",
    ],
    score: 9,
  },
  {
    category: "frontend",
    tag: "frontend",
    keywords: [
      "react",
      "next.js",
      "nextjs",
      "javascript",
      "typescript",
      "css",
      "browser",
      "web app",
    ],
    score: 8,
  },
  {
    category: "devops",
    tag: "devops",
    keywords: [
      "cloud",
      "aws",
      "cloudflare",
      "deployment",
      "docker",
      "kubernetes",
      "ci/cd",
      "serverless",
    ],
    score: 8,
  },
  {
    category: "backend",
    tag: "performance",
    keywords: [
      "performance",
      "benchmark",
      "latency",
      "throughput",
      "memory leak",
      "garbage collection",
    ],
    score: 8,
  },
  {
    category: "other",
    tag: "release",
    keywords: [
      "release",
      "released",
      "stable",
      "beta",
      "rc",
      "changelog",
      "breaking change",
      "migration",
    ],
    score: 7,
  },
  {
    category: "career",
    tag: "career",
    keywords: [
      "career",
      "hiring",
      "interview",
      "salary",
      "developer productivity",
      "developer experience",
    ],
    score: 5,
  },
];

export class AIService {
  private static async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = 8000,
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  }

  public static async translateWithGoogle(
    text: string,
    targetLang: "vi" | "en" = "vi",
  ): Promise<string> {
    if (!text.trim()) {
      return "";
    }

    try {
      console.log(`[Google Translate] Đang dịch sang ${targetLang}: "${text.slice(0, 50)}..."`);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await this.fetchWithTimeout(url, {}, 5000);

      if (!res.ok) {
        throw new Error(`Google Translate status: ${res.status}`);
      }

      const json = (await res.json()) as unknown;
      if (this.isGoogleTranslateResponse(json)) {
        return this.normalizeDevTerms(json[0].map((item) => item[0]).join(""));
      }

      return text;
    } catch (error) {
      console.error("Lỗi Google Translate:", error);
      return text;
    }
  }

  /**
   * Dịch sang tiếng Việt thông minh bằng AI, giữ nguyên thuật ngữ chuyên ngành.
   * Fallback sang Google Translate nếu AI thất bại.
   */
  private static async translateSmartVi(text: string): Promise<string> {
    if (!text.trim()) return "";

    const prompt = `Translate the following text to Vietnamese. IMPORTANT RULES:
1. Keep ALL technical terms, programming terminology, proper nouns, tool names, framework names, library names, and abbreviations in their ORIGINAL English form. Examples: framework, runtime, repository, pull request, cache, deployment, pipeline, container, serverless, API, SDK, CLI, MCP Server, AI Agent, Docker, Kubernetes, Node.js, React, etc.
2. Only translate the natural language parts to Vietnamese with proper diacritics.
3. Return ONLY the translated text, nothing else.

Text to translate:
${text}`;

    const providersToTry: AiProvider[] = [];
    const allProviders: AiProvider[] = ["gemini", "groq", "openai", "openrouter", "cerebras"];
    for (const p of allProviders) {
      if (this.isProviderConfigured(p)) {
        providersToTry.push(p);
      }
    }

    for (const provider of providersToTry) {
      try {
        let result: string | null = null;
        switch (provider) {
          case "gemini": {
            const response = await this.fetchWithTimeout(
              `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                  generationConfig: { temperature: 0.1 },
                }),
              },
            );
            if (response.ok) {
              const data = (await response.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
            }
            break;
          }
          default: {
            const endpoints: Record<string, { url: string; key: string; model: string }> = {
              openai: {
                url: "https://api.openai.com/v1/chat/completions",
                key: env.openaiApiKey,
                model: env.openaiModel,
              },
              groq: {
                url: "https://api.groq.com/openai/v1/chat/completions",
                key: env.groqApiKey,
                model: env.groqModel,
              },
              openrouter: {
                url: "https://openrouter.ai/api/v1/chat/completions",
                key: env.openrouterApiKey,
                model: env.openrouterModel,
              },
              cerebras: {
                url: "https://api.cerebras.ai/v1/chat/completions",
                key: env.cerebrasApiKey,
                model: env.cerebrasModel,
              },
            };
            const ep = endpoints[provider];
            if (!ep) break;
            const response = await this.fetchWithTimeout(ep.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ep.key}`,
              },
              body: JSON.stringify({
                model: ep.model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
              }),
            });
            if (response.ok) {
              const data = (await response.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              result = data.choices?.[0]?.message?.content?.trim() || null;
            }
            break;
          }
        }

        if (result && hasVietnamese(result)) {
          console.log(`[TranslateSmartVi] Dịch thành công bằng ${provider}`);
          return result;
        }
      } catch (error) {
        console.warn(`[TranslateSmartVi] ${provider} thất bại:`, (error as Error).message);
      }
    }

    // Fallback cuối cùng: Google Translate
    console.log(`[TranslateSmartVi] AI thất bại, fallback sang Google Translate`);
    return this.translateWithGoogle(text, "vi");
  }

  /**
   * Tóm tắt bài viết từ nội dung đầy đủ bằng AI.
   * Trả về cấu trúc DetailedSummaryResult.
   */
  static async summarizeFullArticle(
    content: string,
    language: "vi" | "en" = "vi",
  ): Promise<DetailedSummaryResult> {
    const truncated = content.length > 3000 ? content.slice(0, 3000) + "..." : content;

    let promptSystem = SUMMARIZE_PROMPT;
    if (language === "en") {
      promptSystem = promptSystem
        .replace("Vietnamese tech news editor", "English tech news editor")
        .replace("1. Write in Vietnamese with proper accents.", "1. Write in English.")
        .replace(
          '5. "title": rewrite the title in Vietnamese',
          '5. "title": rewrite the title in English',
        )
        .replace("Không có", "None");
    }

    const prompt = `${promptSystem}\n\nArticle content:\n${truncated}`;

    const providersToTry = this.getProvidersToTry();
    if (providersToTry.length === 0) {
      return {
        title: "Không thể tải chi tiết bài viết.",
        summaryPoints: ["AI chưa được cấu hình, bot đang dùng fallback an toàn."],
        whyItMatters: "Không có thông tin đủ tin cậy để phân tích sâu.",
        uncertainty: "Không có provider AI được cấu hình.",
        actions: ["Đọc trực tiếp bài viết từ nguồn gốc."],
        readabilityScore: 0,
        topics: ["fallback"],
      };
    }
    console.log("[Summarize] Providers to try:", providersToTry);

    for (const provider of providersToTry) {
      try {
        console.log(`[Summarize] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              promptSystem,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              promptSystem,
            );
            break;
          case "cerebras":
            rawResult = await this.callChatCompletion(
              "https://api.cerebras.ai/v1/chat/completions",
              env.cerebrasApiKey,
              env.cerebrasModel,
              prompt,
              promptSystem,
            );
            break;
          case "openrouter":
            try {
              rawResult = await this.callChatCompletion(
                "https://openrouter.ai/api/v1/chat/completions",
                env.openrouterApiKey,
                env.openrouterModel,
                prompt,
                promptSystem,
                {
                  "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                  "X-Title": "Chatbot News Telegram",
                },
              );
            } catch (error) {
              if (
                env.openrouterFallbackModel &&
                env.openrouterFallbackModel !== env.openrouterModel
              ) {
                console.warn(
                  `[Summarize OpenRouter] Thất bại với model ${env.openrouterModel}. Đang thử fallback model: ${env.openrouterFallbackModel}. Lỗi: ${(error as Error).message}`,
                );
                rawResult = await this.callChatCompletion(
                  "https://openrouter.ai/api/v1/chat/completions",
                  env.openrouterApiKey,
                  env.openrouterFallbackModel,
                  prompt,
                  promptSystem,
                  {
                    "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                    "X-Title": "Chatbot News Telegram",
                  },
                );
              } else {
                throw error;
              }
            }
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(prompt);
            break;
        }

        const raw = this.isRecord(rawResult) ? rawResult : {};
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        const summaryPoints = Array.isArray(raw.summaryPoints)
          ? raw.summaryPoints.map((p: unknown) => String(p).trim())
          : [];
        const whyItMatters = typeof raw.whyItMatters === "string" ? raw.whyItMatters.trim() : "";
        const uncertainty = typeof raw.uncertainty === "string" ? raw.uncertainty.trim() : "";
        const actions = Array.isArray(raw.actions)
          ? raw.actions.map((a: unknown) => String(a).trim())
          : [];
        const readabilityScore =
          typeof raw.readabilityScore === "number" ? raw.readabilityScore : 7;
        const topics = Array.isArray(raw.topics)
          ? raw.topics.map((t: unknown) => String(t).trim().toLowerCase())
          : [];

        if (summaryPoints.length > 0) {
          const isEn = language === "en";
          const needsTranslate = (text: string) => {
            if (isEn) {
              return hasVietnamese(text);
            } else {
              return !hasVietnamese(text);
            }
          };

          let finalTitle = title;
          if (finalTitle && needsTranslate(finalTitle)) {
            finalTitle = await this.translateWithGoogle(finalTitle, language);
          }

          const finalPoints = [...summaryPoints];
          for (let i = 0; i < finalPoints.length; i++) {
            if (needsTranslate(finalPoints[i])) {
              finalPoints[i] = await this.translateWithGoogle(finalPoints[i], language);
            }
          }

          let finalWhy = whyItMatters;
          if (finalWhy && needsTranslate(finalWhy)) {
            finalWhy = await this.translateWithGoogle(finalWhy, language);
          }

          let finalUncertainty = uncertainty;
          if (
            finalUncertainty &&
            finalUncertainty !== "Không có" &&
            finalUncertainty !== "None" &&
            needsTranslate(finalUncertainty)
          ) {
            finalUncertainty = await this.translateWithGoogle(finalUncertainty, language);
          }

          const finalActions = [...actions];
          for (let i = 0; i < finalActions.length; i++) {
            if (needsTranslate(finalActions[i])) {
              finalActions[i] = await this.translateWithGoogle(finalActions[i], language);
            }
          }

          return {
            title: this.normalizeDevTerms(finalTitle),
            summaryPoints: finalPoints.map((p) => this.normalizeDevTerms(p)),
            whyItMatters: this.normalizeDevTerms(finalWhy),
            uncertainty: this.normalizeDevTerms(finalUncertainty),
            actions: finalActions.map((a) => this.normalizeDevTerms(a)),
            readabilityScore,
            topics,
          };
        }
      } catch (error) {
        console.warn(`[Summarize] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    return {
      title: "Không thể tải chi tiết bài viết.",
      summaryPoints: ["Đã xảy ra sự cố khi xử lý bài viết bằng AI.", "Vui lòng thử lại sau."],
      whyItMatters: "Không có thông tin.",
      uncertainty: "Không có",
      actions: ["Đọc trực tiếp bài viết từ nguồn gốc."],
      readabilityScore: 0,
      topics: ["error"],
    };
  }

  /**
   * Phân tích câu lệnh của người dùng để trích xuất các thể loại tin tức mong muốn bằng AI.
   */
  static async parsePreferredCategories(userPrompt: string): Promise<string[]> {
    if (!userPrompt.trim()) {
      return ["all"];
    }

    const prompt = `User request: "${userPrompt}"`;
    const providersToTry = this.getProvidersToTry();
    if (providersToTry.length === 0) {
      return this.parsePreferencesFallback(userPrompt);
    }

    const systemPrompt = PARSE_PREFERENCES_PROMPT;

    for (const provider of providersToTry) {
      try {
        console.log(`[ParsePreferences] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              systemPrompt,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              systemPrompt,
            );
            break;
          case "cerebras":
            rawResult = await this.callChatCompletion(
              "https://api.cerebras.ai/v1/chat/completions",
              env.cerebrasApiKey,
              env.cerebrasModel,
              prompt,
              systemPrompt,
            );
            break;
          case "openrouter":
            rawResult = await this.callChatCompletion(
              "https://openrouter.ai/api/v1/chat/completions",
              env.openrouterApiKey,
              env.openrouterModel,
              prompt,
              systemPrompt,
              {
                "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                "X-Title": "Chatbot News Telegram",
              },
            );
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(`${systemPrompt}\n\n${prompt}`);
            break;
        }

        // Kiểm tra xem kết quả trả về có phải là mảng hợp lệ không
        if (Array.isArray(rawResult)) {
          const validCategories = [
            "all",
            "ai",
            "backend",
            "frontend",
            "devops",
            "security",
            "mobile",
            "career",
            "other",
          ];
          const result = rawResult
            .map((item) => String(item).toLowerCase().trim())
            .filter((item) => validCategories.includes(item));
          if (result.length > 0) {
            return result;
          }
        }
      } catch (error) {
        console.warn(`[ParsePreferences] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    // Luật fallback nếu tất cả các nhà cung cấp AI đều lỗi
    return this.parsePreferencesFallback(userPrompt);
  }

  public static parsePreferencesFallback(prompt: string): string[] {
    const clean = prompt.toLowerCase();
    const categories: string[] = [];

    if (
      clean.includes("ai") ||
      clean.includes("trí tuệ nhân tạo") ||
      clean.includes("intelligence") ||
      clean.includes("llm") ||
      clean.includes("gpt")
    ) {
      categories.push("ai");
    }
    if (
      clean.includes("backend") ||
      clean.includes("hậu kỳ") ||
      clean.includes("database") ||
      clean.includes("cơ sở dữ liệu") ||
      clean.includes("api") ||
      clean.includes("nodejs")
    ) {
      categories.push("backend");
    }
    if (
      clean.includes("frontend") ||
      clean.includes("giao diện") ||
      clean.includes("web") ||
      clean.includes("react") ||
      clean.includes("html") ||
      clean.includes("css")
    ) {
      categories.push("frontend");
    }
    if (
      clean.includes("devops") ||
      clean.includes("cloud") ||
      clean.includes("aws") ||
      clean.includes("docker") ||
      clean.includes("kubernetes") ||
      clean.includes("ci/cd")
    ) {
      categories.push("devops");
    }
    if (
      clean.includes("security") ||
      clean.includes("bảo mật") ||
      clean.includes("an ninh") ||
      clean.includes("lỗ hổng") ||
      clean.includes("cve")
    ) {
      categories.push("security");
    }
    if (
      clean.includes("mobile") ||
      clean.includes("di động") ||
      clean.includes("android") ||
      clean.includes("ios") ||
      clean.includes("flutter")
    ) {
      categories.push("mobile");
    }
    if (
      clean.includes("career") ||
      clean.includes("sự nghiệp") ||
      clean.includes("tuyển dụng") ||
      clean.includes("phỏng vấn") ||
      clean.includes("lương")
    ) {
      categories.push("career");
    }
    if (clean.includes("khác") || clean.includes("other")) {
      categories.push("other");
    }
    if (
      clean.includes("tất cả") ||
      clean.includes("hết") ||
      clean.includes("mọi tin") ||
      clean.includes("all")
    ) {
      return ["all"];
    }

    return categories.length > 0 ? categories : ["all"];
  }

  /**
   * Lọc danh sách bài viết bằng AI dựa trên prompt sở thích của người dùng.
   */
  static async filterArticlesByPrompt(
    articles: NewsView[],
    userPrompt: string,
  ): Promise<NewsView[]> {
    if (articles.length === 0 || !userPrompt.trim()) {
      return articles;
    }

    const candidateList = articles.map((a, idx) => ({
      index: idx,
      title: a.title || "",
      category: a.category || "other",
      tags: a.tags || [],
      summary: a.summary || "",
    }));

    const systemPrompt = `You are a helpful assistant filtering tech articles based on user preferences.
The user's preference prompt is: "${userPrompt}"
Below is a list of candidate articles in JSON format.
Your job is to return a JSON array containing the indices (0-based) of the articles that are relevant or interesting according to the user's prompt.
If no articles are relevant, return an empty array [].
If all are relevant, return all indices.

Return ONLY a valid JSON array of numbers, e.g. [0, 2]. Do not include markdown code fences, comments, or extra text.`;

    const prompt = JSON.stringify(candidateList, null, 2);

    const providersToTry = this.getProvidersToTry();
    if (providersToTry.length === 0) {
      return articles;
    }

    for (const provider of providersToTry) {
      try {
        console.log(`[FilterArticles] Đang thử provider: ${provider}`);
        let rawResult: unknown;
        switch (provider) {
          case "openai":
            rawResult = await this.callChatCompletion(
              "https://api.openai.com/v1/chat/completions",
              env.openaiApiKey,
              env.openaiModel,
              prompt,
              systemPrompt,
            );
            break;
          case "groq":
            rawResult = await this.callChatCompletion(
              "https://api.groq.com/openai/v1/chat/completions",
              env.groqApiKey,
              env.groqModel,
              prompt,
              systemPrompt,
            );
            break;
          case "cerebras":
            rawResult = await this.callChatCompletion(
              "https://api.cerebras.ai/v1/chat/completions",
              env.cerebrasApiKey,
              env.cerebrasModel,
              prompt,
              systemPrompt,
            );
            break;
          case "openrouter":
            rawResult = await this.callChatCompletion(
              "https://openrouter.ai/api/v1/chat/completions",
              env.openrouterApiKey,
              env.openrouterModel,
              prompt,
              systemPrompt,
              {
                "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                "X-Title": "Chatbot News Telegram",
              },
            );
            break;
          case "gemini":
          default:
            rawResult = await this.callGeminiBatch(`${systemPrompt}\n\nCandidate list:\n${prompt}`);
            break;
        }

        // Kiểm tra xem kết quả trả về có phải là mảng chỉ số hợp lệ không
        if (Array.isArray(rawResult)) {
          const matchedIndices = rawResult
            .map((item) => Number(item))
            .filter((idx) => !isNaN(idx) && idx >= 0 && idx < articles.length);

          if (matchedIndices.length > 0) {
            console.log(
              `[FilterArticles] AI tìm thấy ${matchedIndices.length}/${articles.length} bài viết phù hợp với prompt: "${userPrompt}"`,
            );
            return matchedIndices.map((idx) => articles[idx]);
          }
        }
      } catch (error) {
        console.warn(`[FilterArticles] Thất bại với ${provider}:`, (error as Error).message);
      }
    }

    // Nếu AI fail hoặc không tìm thấy gì, trả về toàn bộ bài viết (fallback)
    return articles;
  }

  static async getFallback(
    title: string,
    content: string,
    source = "Unknown",
    publishedAt = new Date(),
  ): Promise<AIProcessedResult> {
    const baseline = this.inferArticleMetadata(title, content, source, publishedAt);
    const cleanContent = this.cleanContent(content);
    const summarySeed = cleanContent
      ? this.truncate(cleanContent, 350)
      : "No detailed description available.";

    const [titleVi, translatedSummary] = await Promise.all([
      this.translateWithGoogle(title),
      this.translateWithGoogle(summarySeed),
    ]);

    return {
      titleVi: titleVi || title,
      titleEn: title,
      summaryVi: this.formatFallbackSummary(translatedSummary, source, baseline),
      summaryEn: summarySeed,
      category: baseline.category,
      tags: baseline.tags,
      skills: [],
      importanceScore: baseline.importanceScore,
      importanceReasonVi: baseline.importanceReason,
      importanceReasonEn: `Article from ${source}.`,
    };
  }

  private static isProviderConfigured(provider: AiProvider): boolean {
    switch (provider) {
      case "gemini":
        return !!env.geminiApiKey;
      case "openai":
        return !!env.openaiApiKey;
      case "groq":
        return !!env.groqApiKey;
      case "openrouter":
        return !!env.openrouterApiKey;
      case "cerebras":
        return !!env.cerebrasApiKey;
      default:
        return false;
    }
  }

  private static getProvidersToTry(): AiProvider[] {
    const ordered: AiProvider[] = [
      env.aiProvider,
      "openrouter",
      "gemini",
      "openai",
      "groq",
      "cerebras",
    ];
    const seen = new Set<AiProvider>();

    return ordered.filter((provider) => {
      if (seen.has(provider) || !this.isProviderConfigured(provider)) return false;
      seen.add(provider);
      return true;
    });
  }

  private static async withAiRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= AI_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const delay = AI_RETRY_DELAYS_MS[attempt];

        if (delay === undefined || !this.isRetryableAiError(error)) {
          throw error;
        }

        console.warn(
          "[AI Retry] " +
            label +
            " thất bại lần " +
            (attempt + 1) +
            ", thử lại sau " +
            delay +
            "ms: " +
            (error as Error).message,
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private static isRetryableAiError(error: unknown): boolean {
    const err = error as { name?: string; message?: string };
    const message = (err.message || "").toLowerCase();

    return (
      err.name === "AbortError" ||
      message.includes("aborted") ||
      message.includes("timeout") ||
      message.includes("status 408") ||
      message.includes("status 409") ||
      message.includes("status 429") ||
      /status 5\d\d/.test(message)
    );
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Phương án dự phòng cuối cùng: gọi OpenRouter với model free hardcoded.
   * Chỉ được gọi khi TẤT CẢ provider đã cấu hình đều thất bại.
   */
  private static async processWithOpenRouterFree(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    const response = await this.fetchWithTimeout(FREE_FALLBACK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openrouterApiKey}`,
        ...FREE_FALLBACK_HEADERS,
      },
      body: JSON.stringify({
        model: FREE_FALLBACK_MODEL,
        messages: [
          { role: "system", content: TECH_NEWS_PROMPT },
          { role: "user", content: this.buildArticlePrompt(title, content, source, url) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter free API returned status ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const choiceContent = data.choices?.[0]?.message?.content;
    if (!choiceContent) {
      throw new Error("Không nhận được nội dung từ OpenRouter free API.");
    }

    return this.validateAndNormalizeResult(
      JSON.parse(choiceContent) as unknown,
      title,
      content,
      source,
      publishedAt,
    );
  }

  private static async processWithProvider(
    provider: AiProvider,
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    switch (provider) {
      case "openai":
        return this.processWithOpenAI(title, content, source, url, publishedAt);
      case "groq":
        return this.processWithGroq(title, content, source, url, publishedAt);
      case "openrouter":
        return this.processWithOpenRouter(title, content, source, url, publishedAt);
      case "cerebras":
        return this.processWithCerebras(title, content, source, url, publishedAt);
      case "gemini":
      default:
        return this.processWithGemini(title, content, source, url, publishedAt);
    }
  }

  private static async callBatchProvider(
    provider: AiProvider,
    batchPrompt: string,
  ): Promise<unknown> {
    switch (provider) {
      case "openai":
        return this.callChatCompletion(
          "https://api.openai.com/v1/chat/completions",
          env.openaiApiKey,
          env.openaiModel,
          batchPrompt,
        );
      case "groq":
        return this.callChatCompletion(
          "https://api.groq.com/openai/v1/chat/completions",
          env.groqApiKey,
          env.groqModel,
          batchPrompt,
        );
      case "cerebras":
        return this.callChatCompletion(
          "https://api.cerebras.ai/v1/chat/completions",
          env.cerebrasApiKey,
          env.cerebrasModel,
          batchPrompt,
        );
      case "openrouter":
        try {
          return await this.callChatCompletion(
            "https://openrouter.ai/api/v1/chat/completions",
            env.openrouterApiKey,
            env.openrouterModel,
            batchPrompt,
            TECH_NEWS_PROMPT,
            {
              "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
              "X-Title": "Chatbot News Telegram",
            },
          );
        } catch (error) {
          if (env.openrouterFallbackModel && env.openrouterFallbackModel !== env.openrouterModel) {
            console.warn(
              "[AI Batch OpenRouter] Thất bại với model " +
                env.openrouterModel +
                ". Đang thử fallback model: " +
                env.openrouterFallbackModel +
                ". Lỗi: " +
                (error as Error).message,
            );
            return this.callChatCompletion(
              "https://openrouter.ai/api/v1/chat/completions",
              env.openrouterApiKey,
              env.openrouterFallbackModel,
              batchPrompt,
              TECH_NEWS_PROMPT,
              {
                "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
                "X-Title": "Chatbot News Telegram",
              },
            );
          }

          throw error;
        }
      case "gemini":
      default:
        return this.callGeminiBatch(batchPrompt);
    }
  }

  static async processArticle(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt = new Date(),
  ): Promise<AIProcessedResult> {
    const providersToTry = this.getProvidersToTry();

    if (providersToTry.length === 0) {
      console.warn("[AI Failover] Chưa cấu hình provider AI. Sử dụng rule-based fallback.");
      return this.getFallback(title, content, source, publishedAt);
    }

    console.log("[AI Failover] Thứ tự thử nghiệm các AI: " + providersToTry.join(" -> "));

    for (const provider of providersToTry) {
      try {
        console.log('[AI] Đang xử lý bài viết "' + title.slice(0, 45) + '..." bằng: ' + provider);
        const result = await this.withAiRetry(provider, () =>
          this.processWithProvider(provider, title, content, source, url, publishedAt),
        );

        console.log("[AI Failover] Xử lý thành công bằng: " + provider);
        return {
          ...result,
          titleVi: this.normalizeDevTerms(result.titleVi),
          titleEn: this.normalizeDevTerms(result.titleEn),
          summaryVi: this.normalizeDevTerms(result.summaryVi),
          summaryEn: this.normalizeDevTerms(result.summaryEn),
          importanceReasonVi: this.normalizeDevTerms(result.importanceReasonVi),
          importanceReasonEn: this.normalizeDevTerms(result.importanceReasonEn),
        };
      } catch (error) {
        console.warn(
          "[AI Failover] Thất bại với " + provider + ". Lỗi: " + (error as Error).message,
        );
      }
    }

    // Phương án dự phòng cuối: thử OpenRouter free model
    if (env.openrouterApiKey) {
      try {
        console.log(
          "[AI Failover] Thử phương án dự phòng cuối: OpenRouter free (" +
            FREE_FALLBACK_MODEL +
            ")",
        );
        const result = await this.processWithOpenRouterFree(
          title,
          content,
          source,
          url,
          publishedAt,
        );
        console.log("[AI Failover] Xử lý thành công bằng OpenRouter free.");
        return {
          ...result,
          titleVi: this.normalizeDevTerms(result.titleVi),
          titleEn: this.normalizeDevTerms(result.titleEn),
          summaryVi: this.normalizeDevTerms(result.summaryVi),
          summaryEn: this.normalizeDevTerms(result.summaryEn),
          importanceReasonVi: this.normalizeDevTerms(result.importanceReasonVi),
          importanceReasonEn: this.normalizeDevTerms(result.importanceReasonEn),
        };
      } catch (freeError) {
        console.warn(
          "[AI Failover] OpenRouter free cũng thất bại: " + (freeError as Error).message,
        );
      }
    }

    console.warn(
      "[AI Failover] Tất cả các nhà cung cấp AI đều thất bại. Sử dụng rule-based fallback.",
    );
    return this.getFallback(title, content, source, publishedAt);
  }

  /**
   * Xử lý nhiều bài viết trong một lần gọi AI duy nhất.
   * Tiết kiệm API quota bằng cách gộp tối đa 5 bài/prompt.
   * Nếu batch thất bại, sẽ fallback về xử lý từng bài riêng lẻ.
   */
  static async processArticleBatch(articles: ArticleProcessInput[]): Promise<AIProcessedResult[]> {
    if (articles.length === 0) return [];

    const batchPrompt = this.buildBatchPrompt(articles);
    const providersToTry = this.getProvidersToTry();

    if (providersToTry.length === 0) {
      console.warn("[AI Batch] Chưa cấu hình provider AI. Sử dụng rule-based fallback.");
      return Promise.all(
        articles.map((article) =>
          this.getFallback(article.title, article.content, article.source, article.publishedAt),
        ),
      );
    }

    console.log(
      "[AI Batch] Xử lý " +
        articles.length +
        " bài cùng lúc. Thứ tự: " +
        providersToTry.join(" -> "),
    );

    for (const provider of providersToTry) {
      try {
        console.log("[AI Batch] Đang gửi batch " + articles.length + " bài tới: " + provider);
        const rawResult = await this.withAiRetry(provider + " batch", () =>
          this.callBatchProvider(provider, batchPrompt),
        );

        const parsed = await this.parseBatchResult(rawResult, articles);
        if (parsed) {
          console.log("[AI Batch] Batch xử lý thành công bằng: " + provider + ".");
          return parsed.map((result) => ({
            ...result,
            titleVi: this.normalizeDevTerms(result.titleVi),
            titleEn: this.normalizeDevTerms(result.titleEn),
            summaryVi: this.normalizeDevTerms(result.summaryVi),
            summaryEn: this.normalizeDevTerms(result.summaryEn),
            importanceReasonVi: this.normalizeDevTerms(result.importanceReasonVi),
            importanceReasonEn: this.normalizeDevTerms(result.importanceReasonEn),
          }));
        }
      } catch (error) {
        console.warn("[AI Batch] Thất bại với " + provider + ". Lỗi: " + (error as Error).message);
      }
    }

    // Phương án dự phòng cuối: thử OpenRouter free model
    if (env.openrouterApiKey) {
      try {
        console.log(
          "[AI Batch] Thử phương án dự phòng cuối: OpenRouter free (" + FREE_FALLBACK_MODEL + ")",
        );
        const rawResult = await this.callChatCompletion(
          FREE_FALLBACK_ENDPOINT,
          env.openrouterApiKey,
          FREE_FALLBACK_MODEL,
          batchPrompt,
          TECH_NEWS_PROMPT,
          FREE_FALLBACK_HEADERS,
        );
        const parsed = await this.parseBatchResult(rawResult, articles);
        if (parsed) {
          console.log("[AI Batch] OpenRouter free xử lý thành công.");
          return parsed.map((result) => ({
            ...result,
            titleVi: this.normalizeDevTerms(result.titleVi),
            titleEn: this.normalizeDevTerms(result.titleEn),
            summaryVi: this.normalizeDevTerms(result.summaryVi),
            summaryEn: this.normalizeDevTerms(result.summaryEn),
            importanceReasonVi: this.normalizeDevTerms(result.importanceReasonVi),
            importanceReasonEn: this.normalizeDevTerms(result.importanceReasonEn),
          }));
        }
      } catch (freeError) {
        console.warn("[AI Batch] OpenRouter free cũng thất bại: " + (freeError as Error).message);
      }
    }

    console.warn("[AI Batch] Tất cả đều thất bại. Sử dụng rule-based fallback.");
    return Promise.all(
      articles.map((article) =>
        this.getFallback(article.title, article.content, article.source, article.publishedAt),
      ),
    );
  }

  private static buildBatchPrompt(articles: ArticleProcessInput[]): string {
    const articlesJson = articles.map((a, i) => ({
      index: i,
      title: a.title,
      content: this.truncate(this.cleanContent(a.content), 500),
      source: a.source,
      url: a.url,
      commentCount: a.commentCount,
    }));

    return `${TECH_NEWS_PROMPT}

Process ALL of the following ${articles.length} articles and return a JSON object with key "articles" containing an array of results in the SAME order.
Each element must match the schema: { titleVi, titleEn, summaryVi, summaryEn, category, tags, skills, importanceScore, importanceReasonVi, importanceReasonEn }.

Articles:
${JSON.stringify(articlesJson, null, 2)}`;
  }

  private static async callChatCompletion(
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
    systemPrompt: string = TECH_NEWS_PROMPT,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    if (!apiKey) throw new Error(`API key chưa được cấu hình cho ${endpoint}`);

    const response = await this.fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      },
      8000,
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Không nhận được nội dung từ API.");
    return JSON.parse(content);
  }

  private static async callGeminiBatch(prompt: string): Promise<unknown> {
    if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY chưa được cấu hình.");

    const response = await this.fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3,
          },
        }),
      },
      8000,
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Không nhận được nội dung từ Gemini API.");
    return JSON.parse(text);
  }

  private static async parseBatchResult(
    raw: unknown,
    articles: ArticleProcessInput[],
  ): Promise<AIProcessedResult[] | null> {
    if (!this.isRecord(raw)) return null;
    const arr = Array.isArray(raw.articles) ? raw.articles : Array.isArray(raw) ? raw : null;
    if (!arr) return null;

    const results: AIProcessedResult[] = [];
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];

      try {
        if (arr[i] === undefined) {
          throw new Error("AI batch result missing item " + i);
        }

        results.push(
          await this.validateAndNormalizeResult(
            arr[i],
            article.title,
            article.content,
            article.source,
            article.publishedAt,
          ),
        );
      } catch (error) {
        console.warn(
          "[AI Batch] Fallback item " +
            i +
            ' "' +
            article.title.slice(0, 60) +
            '" vì kết quả AI không hợp lệ: ' +
            (error as Error).message,
        );
        results.push(
          await this.getFallback(
            article.title,
            article.content,
            article.source,
            article.publishedAt,
          ),
        );
      }
    }

    return results;
  }

  private static async processWithGemini(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await this.fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: this.buildArticlePrompt(title, content, source, url),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  titleVi: { type: "STRING" },
                  titleEn: { type: "STRING" },
                  summaryVi: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  summaryEn: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  category: {
                    type: "STRING",
                    enum: CATEGORY_OPTIONS,
                  },
                  tags: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  skills: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                  },
                  importanceScore: { type: "INTEGER" },
                  importanceReasonVi: { type: "STRING" },
                  importanceReasonEn: { type: "STRING" },
                },
                required: [
                  "titleVi",
                  "titleEn",
                  "summaryVi",
                  "summaryEn",
                  "category",
                  "tags",
                  "skills",
                  "importanceScore",
                  "importanceReasonVi",
                  "importanceReasonEn",
                ],
              },
              temperature: 0.3,
            },
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error("Không nhận được nội dung văn bản từ Gemini API.");
      }

      const result = JSON.parse(responseText) as unknown;
      return await this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Gemini (${env.geminiModel}):`, error);
      throw error;
    }
  }

  private static async processWithOpenAI(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.openaiApiKey) {
      throw new Error("OPENAI_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await this.fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openaiModel,
          messages: [
            {
              role: "system",
              content: TECH_NEWS_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify({ title, content, source, url }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ OpenAI API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return await this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng OpenAI (${env.openaiModel}):`, error);
      throw error;
    }
  }

  private static async processWithGroq(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.groqApiKey) {
      throw new Error("GROQ_API_KEY chưa được cấu hình.");
    }

    try {
      const response = await this.fetchWithTimeout(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.groqApiKey}`,
          },
          body: JSON.stringify({
            model: env.groqModel,
            messages: [
              {
                role: "system",
                content: TECH_NEWS_PROMPT,
              },
              {
                role: "user",
                content: JSON.stringify({ title, content, source, url }),
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ Groq API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return await this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Groq (${env.groqModel}):`, error);
      throw error;
    }
  }

  private static async processWithOpenRouter(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    if (!env.openrouterApiKey) {
      throw new Error("OPENROUTER_API_KEY chưa được cấu hình.");
    }

    const callWithModel = async (modelName: string) => {
      const response = await this.fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.openrouterApiKey}`,
            "HTTP-Referer": "https://github.com/DucPhong08/ChatbotTele",
            "X-Title": "Chatbot News Telegram",
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: "system",
                content: TECH_NEWS_PROMPT,
              },
              {
                role: "user",
                content: this.buildArticlePrompt(title, content, source, url),
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const choiceContent = data.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ OpenRouter API.");
      }

      const result = JSON.parse(choiceContent) as unknown;
      return await this.validateAndNormalizeResult(result, title, content, source, publishedAt);
    };

    try {
      return await callWithModel(env.openrouterModel);
    } catch (error) {
      if (env.openrouterFallbackModel && env.openrouterFallbackModel !== env.openrouterModel) {
        console.warn(
          `[OpenRouter] Thất bại với model ${env.openrouterModel}. Đang thử fallback model: ${env.openrouterFallbackModel}. Lỗi: ${(error as Error).message}`,
        );
        try {
          return await callWithModel(env.openrouterFallbackModel);
        } catch (fallbackError) {
          console.error(
            `[OpenRouter] Thất bại với cả fallback model ${env.openrouterFallbackModel}:`,
            fallbackError,
          );
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  private static async processWithCerebras(
    title: string,
    content: string,
    source: string,
    url: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    try {
      const rawResult = await this.callChatCompletion(
        "https://api.cerebras.ai/v1/chat/completions",
        env.cerebrasApiKey,
        env.cerebrasModel,
        this.buildArticlePrompt(title, content, source, url),
      );
      return await this.validateAndNormalizeResult(rawResult, title, content, source, publishedAt);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Cerebras (${env.cerebrasModel}):`, error);
      throw error;
    }
  }

  private static buildArticlePrompt(
    title: string,
    content: string,
    source: string,
    url: string,
  ): string {
    return `${TECH_NEWS_PROMPT}\n\nArticle details to process:\nTitle: ${title}\nContent: ${content}\nSource: ${source}\nURL: ${url}`;
  }

  private static async validateAndNormalizeResult(
    result: unknown,
    title: string,
    content: string,
    source: string,
    publishedAt: Date,
  ): Promise<AIProcessedResult> {
    const baseline = this.inferArticleMetadata(title, content, source, publishedAt);
    const raw = this.isRecord(result) ? result : {};
    const category = this.isCategory(raw.category) ? raw.category : baseline.category;
    const aiScore = this.readScore(raw.importanceScore);
    const importanceScore =
      aiScore === null
        ? baseline.importanceScore
        : this.clampScore(aiScore, 1, baseline.importanceScore + 25);

    // Parse Vietnamese summary
    const rawSummaryVi = raw.summaryVi ?? raw.summary;
    let summaryViStr = "";
    if (Array.isArray(rawSummaryVi)) {
      summaryViStr = rawSummaryVi
        .map((s) => String(s).trim())
        .filter(Boolean)
        .map((s) => (s.startsWith("-") || s.startsWith("*") ? s : `- ${s}`))
        .join("\n");
    } else if (typeof rawSummaryVi === "string") {
      summaryViStr = rawSummaryVi.trim();
    }

    // Parse English summary
    const rawSummaryEn = raw.summaryEn;
    let summaryEnStr = "";
    if (Array.isArray(rawSummaryEn)) {
      summaryEnStr = rawSummaryEn
        .map((s) => String(s).trim())
        .filter(Boolean)
        .map((s) => (s.startsWith("-") || s.startsWith("*") ? s : `- ${s}`))
        .join("\n");
    } else if (typeof rawSummaryEn === "string") {
      summaryEnStr = rawSummaryEn.trim();
    }

    // Fallbacks if summaries are empty
    const defaultSummary =
      this.truncate(this.cleanContent(content), 300) || "No detailed description available.";
    if (!summaryViStr) {
      summaryViStr = defaultSummary;
    }
    if (!summaryEnStr) {
      summaryEnStr = defaultSummary;
    }

    // Parse titles
    let titleVi =
      typeof raw.titleVi === "string" && raw.titleVi.trim()
        ? raw.titleVi.trim()
        : typeof raw.title === "string" && raw.title.trim()
          ? raw.title.trim()
          : title;
    let titleEn =
      typeof raw.titleEn === "string" && raw.titleEn.trim() ? raw.titleEn.trim() : title;

    titleVi = this.truncate(titleVi, 120);
    titleEn = this.truncate(titleEn, 120);

    const tags = Array.from(new Set([...this.normalizeTags(raw.tags), ...baseline.tags])).slice(
      0,
      10,
    );
    const skills = this.normalizeTags(raw.skills);

    // Parse importance reasons
    let importanceReasonVi =
      typeof raw.importanceReasonVi === "string" && raw.importanceReasonVi.trim()
        ? raw.importanceReasonVi.trim()
        : typeof raw.importanceReason === "string" && raw.importanceReason.trim()
          ? raw.importanceReason.trim()
          : baseline.importanceReason;

    let importanceReasonEn =
      typeof raw.importanceReasonEn === "string" && raw.importanceReasonEn.trim()
        ? raw.importanceReasonEn.trim()
        : `Relevant news for developers from ${source}.`;

    importanceReasonVi = this.truncate(importanceReasonVi, 150);
    importanceReasonEn = this.truncate(importanceReasonEn, 150);

    // Post-processing: nếu các field tiếng Việt không chứa tiếng Việt, tự động dịch bằng AI (giữ thuật ngữ chuyên ngành)
    if (!hasVietnamese(titleVi) && titleVi.length > 0) {
      console.log(
        `[Auto-translate] titleVi không phải tiếng Việt, đang dịch: "${titleVi.slice(0, 50)}..."`,
      );
      const translated = await this.translateSmartVi(titleVi);
      if (translated && hasVietnamese(translated)) {
        titleVi = this.truncate(translated, 120);
      }
    }
    if (!hasVietnamese(summaryViStr) && summaryViStr.length > 0) {
      console.log(`[Auto-translate] summaryVi không phải tiếng Việt, đang dịch...`);
      const translated = await this.translateSmartVi(summaryViStr.slice(0, 600));
      if (translated && hasVietnamese(translated)) {
        summaryViStr = translated;
      }
    }
    if (!hasVietnamese(importanceReasonVi) && importanceReasonVi.length > 0) {
      const translated = await this.translateSmartVi(importanceReasonVi);
      if (translated && hasVietnamese(translated)) {
        importanceReasonVi = this.truncate(translated, 150);
      }
    }

    return {
      titleVi,
      titleEn,
      summaryVi: summaryViStr,
      summaryEn: summaryEnStr,
      category,
      tags,
      skills,
      importanceScore,
      importanceReasonVi,
      importanceReasonEn,
    };
  }

  private static inferArticleMetadata(
    title: string,
    content: string,
    source: string,
    publishedAt: Date,
  ): InferredMetadata {
    const text = `${title} ${this.cleanContent(content)}`.toLowerCase();
    const tags = new Set<string>();
    const categoryScores = new Map<ArticleCategory, number>();
    let keywordScore = 0;

    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((keyword) => this.includesKeyword(text, keyword))) {
        tags.add(rule.tag);
        keywordScore += rule.score;
        categoryScores.set(rule.category, (categoryScores.get(rule.category) || 0) + rule.score);
      }
    }

    const category = this.pickCategory(source, categoryScores);
    const sourceScore = SOURCE_SCORES[source] ?? 8;
    const freshnessScore = this.getFreshnessScore(publishedAt);
    const categoryBoost =
      category === "security"
        ? 10
        : category === "ai"
          ? 8
          : ["backend", "devops"].includes(category)
            ? 5
            : 0;
    const importanceScore = this.clampScore(
      25 + sourceScore + Math.min(keywordScore, 35) + freshnessScore + categoryBoost,
    );

    if (tags.size === 0 && category !== "other") {
      tags.add(category);
    }

    return {
      category,
      tags: Array.from(tags).slice(0, 8),
      importanceScore,
      importanceReason: this.buildImportanceReason(
        source,
        category,
        Array.from(tags),
        freshnessScore,
      ),
    };
  }

  private static pickCategory(
    source: string,
    categoryScores: Map<ArticleCategory, number>,
  ): ArticleCategory {
    let bestCategory: ArticleCategory = this.categoryFromSource(source);
    let bestScore = 0;

    for (const [category, score] of categoryScores.entries()) {
      if (category !== "other" && score > bestScore) {
        bestCategory = category;
        bestScore = score;
      }
    }

    return bestCategory;
  }

  private static categoryFromSource(source: string): ArticleCategory {
    if (["OpenAI Blog", "Hugging Face Blog"].includes(source)) {
      return "ai";
    }

    if (["React Blog", "Vercel Blog"].includes(source)) {
      return "frontend";
    }

    if (["Cloudflare Changelog", "AWS What's New", "GitHub Blog"].includes(source)) {
      return "devops";
    }

    return "other";
  }

  private static getFreshnessScore(publishedAt: Date): number {
    const ageMs = Date.now() - publishedAt.getTime();
    const ageHours = ageMs / (60 * 60 * 1000);

    if (!Number.isFinite(ageHours) || ageHours < 0) {
      return 10;
    }

    if (ageHours <= 24) {
      return 12;
    }

    if (ageHours <= 72) {
      return 8;
    }

    if (ageHours <= 168) {
      return 4;
    }

    return 0;
  }

  private static buildImportanceReason(
    source: string,
    category: ArticleCategory,
    tags: string[],
    freshnessScore: number,
  ): string {
    const reasons = [`Nguồn ${source} có độ liên quan với developer`];

    if (category !== "other") {
      reasons.push(`bài thuộc nhóm ${category}`);
    }

    if (tags.length > 0) {
      reasons.push(`có tín hiệu về ${tags.slice(0, 3).join(", ")}`);
    }

    if (freshnessScore >= 8) {
      reasons.push("tin còn mới");
    }

    return `${reasons.join(", ")}.`;
  }

  private static formatFallbackSummary(
    summary: string,
    source: string,
    metadata: InferredMetadata,
  ): string {
    const detail = summary.trim() || "Bài viết không cung cấp mô tả chi tiết trong RSS.";
    const tags = metadata.tags.length > 0 ? metadata.tags.join(", ") : "chưa xác định";

    return [
      `- ${detail}`,
      `- Nguồn: ${source}; phân loại tạm: ${metadata.category}; tags: ${tags}.`,
      "- Tóm tắt này được tạo bằng fallback rule-based vì AI không khả dụng hoặc trả lỗi.",
    ].join("\n");
  }

  private static cleanContent(content: string): string {
    return content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  private static normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((tag) => String(tag).trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 8);
  }

  private static normalizeDevTerms(text: string): string {
    const replacements: Array<[RegExp, string]> = [
      [/khung làm việc/gi, "framework"],
      [/thời gian chạy/gi, "runtime"],
      [/kho lưu trữ/gi, "repository"],
      [/yêu cầu kéo/gi, "pull request"],
      [/bộ nhớ đệm/gi, "cache"],
      [/thu gom rác/gi, "garbage collection"],
      [/rò rỉ bộ nhớ/gi, "memory leak"],
      [/không máy chủ/gi, "serverless"],
    ];

    return replacements.reduce((current, [pattern, replacement]) => {
      return current.replace(pattern, replacement);
    }, text);
  }

  private static includesKeyword(text: string, keyword: string): boolean {
    if (keyword.length <= 3) {
      return new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, "i").test(text);
    }

    return text.includes(keyword.toLowerCase());
  }

  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static readScore(value: unknown): number | null {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }

    return this.clampScore(value);
  }

  private static clampScore(value: number, min = 1, max = 100): number {
    return Math.min(Math.max(Math.round(value), min), max);
  }

  private static isCategory(value: unknown): value is ArticleCategory {
    return typeof value === "string" && CATEGORY_OPTIONS.includes(value as ArticleCategory);
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private static isGoogleTranslateResponse(value: unknown): value is GoogleTranslateResponse {
    return (
      Array.isArray(value) &&
      Array.isArray(value[0]) &&
      value[0].every((item) => Array.isArray(item) && typeof item[0] === "string")
    );
  }
}
