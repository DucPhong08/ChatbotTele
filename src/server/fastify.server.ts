import Fastify, { type FastifyInstance } from "fastify";
import { webhookCallback, type Bot, type Context } from "grammy";
import { type TelegramMode } from "../config/env";

export function createFastifyServer(
  bot: Bot<Context>,
  telegramMode: TelegramMode,
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (telegramMode === "webhook") {
    // This route is only active when the app runs behind a public HTTPS URL.
    app.post("/telegram/webhook", webhookCallback(bot, "fastify"));
  }

  return app;
}
