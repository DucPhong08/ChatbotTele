import dotenv from "dotenv";

dotenv.config();

export type TelegramMode = "polling" | "webhook";
export type AiProvider = "gemini" | "openai" | "groq" | "openrouter" | "cerebras";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }

  return value;
}

function readTelegramMode(): TelegramMode {
  const mode = process.env.TELEGRAM_MODE?.trim() || "polling";

  if (mode !== "polling" && mode !== "webhook") {
    throw new Error("TELEGRAM_MODE phải là 'polling' hoặc 'webhook'");
  }

  return mode;
}

function readAiProvider(): AiProvider {
  const provider = process.env.AI_PROVIDER?.trim() || "gemini";

  if (
    provider !== "gemini" &&
    provider !== "openai" &&
    provider !== "groq" &&
    provider !== "openrouter" &&
    provider !== "cerebras"
  ) {
    throw new Error("AI_PROVIDER phải là gemini, openai, groq, openrouter hoặc cerebras");
  }

  return provider;
}

function readPort(): number {
  const rawPort = process.env.PORT?.trim() || "3000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT phải là một số nguyên dương");
  }

  return port;
}

function readNotificationMinScore(): number {
  const rawScore = process.env.NEWS_NOTIFICATION_MIN_SCORE?.trim() || "65";
  const score = Number(rawScore);

  if (!Number.isInteger(score) || score < 1 || score > 100) {
    throw new Error("NEWS_NOTIFICATION_MIN_SCORE phải là số nguyên từ 1 đến 100");
  }

  return score;
}

function readAdminChatIds(): number[] {
  const rawIds = process.env.ADMIN_CHAT_IDS?.trim();

  if (!rawIds) {
    return [];
  }

  return rawIds.split(",").map((rawId) => {
    const value = rawId.trim();
    const chatId = Number(value);

    if (!value || !Number.isSafeInteger(chatId)) {
      throw new Error("ADMIN_CHAT_IDS phải là danh sách chat id hợp lệ, phân tách bằng dấu phẩy");
    }

    return chatId;
  });
}

const telegramMode = readTelegramMode();
const webhookUrl = (process.env.WEBHOOK_URL?.trim() || "").replace(/\/$/, "");

if (telegramMode === "webhook" && !webhookUrl) {
  throw new Error("Yêu cầu phải có WEBHOOK_URL khi TELEGRAM_MODE=webhook");
}

export const env = {
  botToken: requiredEnv("BOT_TOKEN"),
  mongoUri: requiredEnv("MONGO_URI"),
  telegramMode,
  webhookUrl,
  port: readPort(),
  newsCron: process.env.NEWS_CRON?.trim() || "*/30 * * * *",
  notificationMinScore: readNotificationMinScore(),
  aiProvider: readAiProvider(),
  adminChatIds: readAdminChatIds(),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5-nano",
  groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
  openrouterModel: process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-flash:free",
  openrouterFallbackModel: process.env.OPENROUTER_FALLBACK_MODEL?.trim() || "",
  cerebrasApiKey: process.env.CEREBRAS_API_KEY?.trim() || "",
  cerebrasModel: process.env.CEREBRAS_MODEL?.trim() || "gpt-oss-120b",
  rsshubUrl: process.env.RSSHUB_URL?.trim() || "http://localhost:1200",
  feedSource: process.env.FEED_SOURCE?.trim() || "dev",
};
