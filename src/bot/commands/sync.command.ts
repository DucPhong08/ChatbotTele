import { type Bot, type Context } from "grammy";
import { NewsCollector } from "../../news/news.collector";
import { env } from "../../config/env";

export function registerSyncCommand(bot: Bot<Context>, collector: NewsCollector): void {
  bot.command("sync", async (ctx) => {
    const chatId = ctx.chat.id;

    if (!env.adminChatIds.includes(chatId)) {
      await ctx.reply(
        env.adminChatIds.length === 0
          ? "Lệnh /sync chưa được cấu hình admin. Vui lòng thiết lập ADMIN_CHAT_IDS."
          : "Bạn không có quyền chạy lệnh /sync.",
      );
      return;
    }

    console.log("[SyncCommand] Đang tiến hành thu thập tin tức mới bằng AI...");

    try {
      const newArticles = await collector.collect();

      if (newArticles.length === 0) {
        console.log("[SyncCommand] Đã hoàn tất kiểm tra. Không có tin tức mới nào.");
        await ctx.reply("Không có tin tức mới nào.");
        return;
      }

      const notifyArticles = newArticles.filter((article) => {
        const score = Number.isInteger(article.importanceScore) ? article.importanceScore! : 50;
        return score >= env.notificationMinScore;
      });

      if (notifyArticles.length === 0) {
        console.log(
          `[SyncCommand] Đã thu thập thêm ${newArticles.length} bài viết mới, nhưng chưa có bài nào đạt ngưỡng gửi ${env.notificationMinScore}/100.`,
        );
        await ctx.reply("Không có bài viết mới nào đủ tiêu chuẩn gửi.");
        return;
      }

      // Sắp xếp các bài viết mới thu thập được theo tầm quan trọng giảm dần và lấy tối đa 5 bài
      const sortedNew = [...notifyArticles].sort((a, b) => {
        const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
        const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;
        return scoreB - scoreA;
      });
      const topNew = sortedNew.slice(0, 5);

      console.log(
        `[SyncCommand] Đã thu thập thêm ${newArticles.length} bài viết mới. Tiến hành gửi tin theo sở thích của từng người dùng...`,
      );

      // Phát tin tới các subscriber sử dụng broadcaster để tránh bị rate limit
      const { broadcastToSubscribers } = await import("../telegram.broadcaster");
      const result = await broadcastToSubscribers(bot, notifyArticles, topNew, ctx.me.username);

      console.log(
        `[SyncCommand] Đã hoàn tất gửi tin tức mới:\n- Gửi thành công: ${result.sent} người dùng\n- Bỏ qua (không trùng sở thích): ${result.skipped}\n- Lỗi/Bị chặn: ${result.failed + result.deactivated}`,
      );
    } catch (error) {
      console.error("Lỗi khi chạy lệnh /sync:", error);
      await ctx.reply("Tiến trình thu thập tin tức thất bại. Vui lòng kiểm tra lại cấu hình AI.");
    }
  });
}
