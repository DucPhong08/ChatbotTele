import { type Bot, type Context } from "grammy";
import { NewsModel } from "../../news/news.model";
import { SubscriberModel } from "../subscriber.model";
import { env } from "../../config/env";

export function registerStatsCommand(bot: Bot<Context>): void {
  bot.command("stats", async (ctx) => {
    const chatId = ctx.chat.id;

    if (env.adminChatIds.length > 0 && !env.adminChatIds.includes(chatId)) {
      await ctx.reply("Bạn không có quyền chạy lệnh /stats.");
      return;
    }

    try {
      const [totalNews, last24h, subscriberCount] = await Promise.all([
        NewsModel.countDocuments(),
        NewsModel.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }),
        SubscriberModel.countDocuments(),
      ]);

      const statsText = [
        "<b>THỐNG KÊ BOT</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `Tổng bài viết trong DB: ${totalNews}`,
        `Bài mới trong 24h qua: ${last24h}`,
        `Subscriber đăng ký: ${subscriberCount}`,
        `AI Provider chính: ${env.aiProvider}`,
        `Môi trường: ${process.env.APP_ENV || "local"}`,
        "━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");

      await ctx.reply(statsText, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Lỗi khi xử lý lệnh /stats:", error);
      await ctx.reply("Đã xảy ra lỗi khi lấy thống kê. Vui lòng thử lại sau!");
    }
  });
}
