import { type Bot, type Context } from "grammy";
import { env } from "../../config/env";

export function registerPingCommand(bot: Bot<Context>): void {
  bot.command("ping", async (ctx) => {
    const chatId = ctx.chat.id;

    if (env.adminChatIds.length > 0 && !env.adminChatIds.includes(chatId)) {
      await ctx.reply("Bạn không có quyền chạy lệnh /ping.");
      return;
    }

    const appEnv = process.env.APP_ENV || "local";
    await ctx.reply(`pong (môi trường: ${appEnv})`);
  });
}
