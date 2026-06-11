import { type Bot, type Context } from "grammy";

export function registerPingCommand(bot: Bot<Context>): void {
  bot.command("ping", async (ctx) => {
    const appEnv = process.env.APP_ENV || "local";
    await ctx.reply(`pong (môi trường: ${appEnv})`);
  });
}
