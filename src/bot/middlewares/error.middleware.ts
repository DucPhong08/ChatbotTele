import { type BotError, type Context } from "grammy";

export function handleBotError(error: BotError<Context>): void {
  console.error("Lỗi bot Telegram:", {
    updateId: error.ctx.update.update_id,
    error: error.error,
  });
}
