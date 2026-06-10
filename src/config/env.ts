import dotenv from "dotenv";

dotenv.config();

export type TelegramMode = "polling" | "webhook";

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

function readPort(): number {
  const rawPort = process.env.PORT?.trim() || "3000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT phải là một số nguyên dương");
  }

  return port;
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
  aiProvider: (process.env.AI_PROVIDER?.trim() || "gemini") as "gemini" | "openai" | "groq",
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5-nano",
  groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
  groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
};

