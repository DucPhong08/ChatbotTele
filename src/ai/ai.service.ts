import { env } from "../config/env";

export interface AIProcessedResult {
  titleVi: string;
  summaryVi: string;
  category: "ai" | "backend" | "frontend" | "devops" | "security" | "mobile" | "career" | "other";
  tags: string[];
  importanceScore: number;
}

export class AIService {
  private static async translateWithGoogle(text: string): Promise<string> {
    if (!text || text.trim() === "") return "";
    try {
      console.log(`[Google Translate] Đang dịch: "${text.slice(0, 50)}..."`);
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Google Translate status: ${res.status}`);
      const json = await res.json() as any;
      if (Array.isArray(json) && Array.isArray(json[0])) {
        return json[0].map((item: any) => item[0]).join("");
      }
      return text;
    } catch (error) {
      console.error("Lỗi Google Translate:", error);
      return text;
    }
  }

  static async getFallback(title: string, content: string): Promise<AIProcessedResult> {
    const cleanContent = content ? content.replace(/<[^>]*>/g, "").trim() : "";
    const isLinkOnly = !cleanContent || cleanContent.toLowerCase().includes("article url:") || cleanContent.startsWith("http");
    const summary = isLinkOnly
      ? "Không có nội dung mô tả chi tiết."
      : (cleanContent.length > 200 ? cleanContent.slice(0, 200) + "..." : cleanContent);

    const [titleVi, summaryVi] = await Promise.all([
      this.translateWithGoogle(title),
      isLinkOnly ? Promise.resolve(summary) : this.translateWithGoogle(summary),
    ]);

    return {
      titleVi,
      summaryVi,
      category: "other",
      tags: [],
      importanceScore: 50,
    };
  }

  static async processArticle(
    title: string,
    content: string,
    source: string,
    url: string,
  ): Promise<AIProcessedResult> {
    const provider = env.aiProvider;

    switch (provider) {
      case "openai":
        return this.processWithOpenAI(title, content, source, url);
      case "groq":
        return this.processWithGroq(title, content, source, url);
      case "gemini":
      default:
        return this.processWithGemini(title, content, source, url);
    }
  }

  private static async processWithGemini(
    title: string,
    content: string,
    source: string,
    url: string,
  ): Promise<AIProcessedResult> {
    if (!env.geminiApiKey) {
      console.warn("Cảnh báo: GEMINI_API_KEY chưa được cấu hình. Sử dụng dữ liệu mặc định (fallback).");
      return this.getFallback(title, content);
    }

    try {
      const response = await fetch(
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
                    text: `You are an expert IT translator and technical editor. Your task is to process a tech news article and return a clean JSON object matching the schema.
Follow these constraints strictly:
1. Translate both the title ("titleVi") and summary ("summaryVi") into professional Vietnamese. Do NOT translate word-for-word.
2. Keep familiar technical terms in English (e.g., API, thread, garbage collection, runtime, framework, deployment, repository, frontend, backend, database).
3. "summaryVi" MUST be a bulleted list of 3 to 5 short key points written in Vietnamese. It must summarize the actual news/technical topic. Do NOT copy the article URL, links, or metadata into the summary.
4. "category" must be strictly one of: "ai", "backend", "frontend", "devops", "security", "mobile", "career", or "other".
5. "tags" must be an array of relevant technology tags (e.g., ["nodejs", "mongodb", "concurrency"]).
6. "importanceScore" must be an integer between 1 and 100 based on the technical value and impact of the news.
7. If the content/description is short, missing, or only contains metadata/links (e.g. "Article URL: ..."), you MUST analyze and infer the news topic based on the title, and write a 3 to 5 bullet point summary in Vietnamese explaining the significance of that news topic. Never output the URL, metadata, or English placeholders as the summary.

Article details to process:
Title: ${title}
Content: ${content}
Source: ${source}
URL: ${url}`
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  titleVi: { type: "STRING" },
                  summaryVi: { type: "STRING" },
                  category: {
                    type: "STRING",
                    enum: ["ai", "backend", "frontend", "devops", "security", "mobile", "career", "other"]
                  },
                  tags: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  },
                  importanceScore: { type: "INTEGER" }
                },
                required: ["titleVi", "summaryVi", "category", "tags", "importanceScore"]
              },
              temperature: 0.3
            }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error("Không nhận được nội dung văn bản từ Gemini API.");
      }

      const result = JSON.parse(responseText) as AIProcessedResult;
      return this.validateAndNormalizeResult(result, title, content);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Gemini (${env.geminiModel}):`, error);
      return this.getFallback(title, content);
    }
  }

  private static async processWithOpenAI(
    title: string,
    content: string,
    source: string,
    url: string,
  ): Promise<AIProcessedResult> {
    if (!env.openaiApiKey) {
      console.warn("Cảnh báo: OPENAI_API_KEY chưa được cấu hình. Sử dụng dữ liệu mặc định (fallback).");
      return this.getFallback(title, content);
    }

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
              content: `You are an expert IT translator and technical editor. Your task is to process a tech news article and return a clean JSON object matching the schema.
Follow these constraints strictly:
1. Translate both the title ("titleVi") and summary ("summaryVi") into professional Vietnamese. Do NOT translate word-for-word.
2. Keep familiar technical terms in English (e.g., API, thread, garbage collection, runtime, framework, deployment, repository, frontend, backend, database).
3. "summaryVi" MUST be a bulleted list of 3 to 5 short key points written in Vietnamese. It must summarize the actual news/technical topic. Do NOT copy the article URL, links, or metadata into the summary.
4. "category" must be strictly one of: "ai", "backend", "frontend", "devops", "security", "mobile", "career", or "other".
5. "tags" must be an array of relevant technology tags (e.g., ["nodejs", "mongodb", "concurrency"]).
6. "importanceScore" must be an integer between 1 and 100 based on the technical value and impact of the news.
7. If the content/description is short, missing, or only contains metadata/links (e.g. "Article URL: ..."), you MUST analyze and infer the news topic based on the title, and write a 3 to 5 bullet point summary in Vietnamese explaining the significance of that news topic. Never output the URL, metadata, or English placeholders as the summary.
8. Output ONLY a valid JSON object matching the requested schema. No conversational text, no markdown block syntax.

JSON Schema format:
{
  "titleVi": "string",
  "summaryVi": "string",
  "category": "ai | backend | frontend | devops | security | mobile | career | other",
  "tags": ["string"],
  "importanceScore": number
}`,
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

      const data = (await response.json()) as any;
      const choiceContent = data?.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ OpenAI API.");
      }

      const result = JSON.parse(choiceContent) as AIProcessedResult;
      return this.validateAndNormalizeResult(result, title, content);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng OpenAI (${env.openaiModel}):`, error);
      return this.getFallback(title, content);
    }
  }

  private static async processWithGroq(
    title: string,
    content: string,
    source: string,
    url: string,
  ): Promise<AIProcessedResult> {
    if (!env.groqApiKey) {
      console.warn("Cảnh báo: GROQ_API_KEY chưa được cấu hình. Sử dụng dữ liệu mặc định (fallback).");
      return this.getFallback(title, content);
    }

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
              content: `You are an expert IT translator and technical editor. Your task is to process a tech news article and return a clean JSON object matching the schema.
Follow these constraints strictly:
1. Translate both the title ("titleVi") and summary ("summaryVi") into professional Vietnamese. Do NOT translate word-for-word.
2. Keep familiar technical terms in English (e.g., API, thread, garbage collection, runtime, framework, deployment, repository, frontend, backend, database).
3. "summaryVi" MUST be a bulleted list of 3 to 5 short key points written in Vietnamese. It must summarize the actual news/technical topic. Do NOT copy the article URL, links, or metadata into the summary.
4. "category" must be strictly one of: "ai", "backend", "frontend", "devops", "security", "mobile", "career", or "other".
5. "tags" must be an array of relevant technology tags (e.g., ["nodejs", "mongodb", "concurrency"]).
6. "importanceScore" must be an integer between 1 and 100 based on the technical value and impact of the news.
7. If the content/description is short, missing, or only contains metadata/links (e.g. "Article URL: ..."), you MUST analyze and infer the news topic based on the title, and write a 3 to 5 bullet point summary in Vietnamese explaining the significance of that news topic. Never output the URL, metadata, or English placeholders as the summary.
8. Output ONLY a valid JSON object matching the requested schema. No conversational text, no markdown block syntax.

JSON Schema format:
{
  "titleVi": "string",
  "summaryVi": "string",
  "category": "ai | backend | frontend | devops | security | mobile | career | other",
  "tags": ["string"],
  "importanceScore": number
}`,
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
        throw new Error(`Groq API returned status ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const choiceContent = data?.choices?.[0]?.message?.content;
      if (!choiceContent) {
        throw new Error("Không nhận được nội dung từ Groq API.");
      }

      const result = JSON.parse(choiceContent) as AIProcessedResult;
      return this.validateAndNormalizeResult(result, title, content);
    } catch (error) {
      console.error(`Lỗi khi xử lý bài viết bằng Groq (${env.groqModel}):`, error);
      return this.getFallback(title, content);
    }
  }

  private static validateAndNormalizeResult(
    result: any,
    title: string,
    content: string,
  ): AIProcessedResult {
    const categoryOptions = ["ai", "backend", "frontend", "devops", "security", "mobile", "career", "other"];
    const category = (categoryOptions.includes(result?.category) ? result.category : "other") as AIProcessedResult["category"];

    let summaryVi = typeof result?.summaryVi === "string" ? result.summaryVi.trim() : "";
    const isLinkOnly = !summaryVi || summaryVi.toLowerCase().includes("article url:") || summaryVi.startsWith("http");
    if (isLinkOnly) {
      const cleanContent = content ? content.replace(/<[^>]*>/g, "").trim() : "";
      const isContentLink = !cleanContent || cleanContent.toLowerCase().includes("article url:") || cleanContent.startsWith("http");
      summaryVi = isContentLink ? "Không có nội dung mô tả chi tiết." : cleanContent;
    }

    return {
      titleVi: typeof result?.titleVi === "string" ? result.titleVi.trim() : title,
      summaryVi,
      category,
      tags: Array.isArray(result?.tags) ? result.tags.map((t: any) => String(t).trim().toLowerCase()) : [],
      importanceScore: typeof result?.importanceScore === "number" && !Number.isNaN(result.importanceScore)
        ? Math.min(Math.max(Math.round(result.importanceScore), 1), 100)
        : 50,
    };
  }
}
