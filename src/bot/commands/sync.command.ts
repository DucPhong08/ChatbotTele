import { type Bot, type Context } from "grammy";
import { NewsCollector } from "../../news/news.collector";
import { SubscriberModel } from "../subscriber.model";
import { formatArticlesBatch } from "../../news/news.formatter";
import { env } from "../../config/env";

export function registerSyncCommand(
  bot: Bot<Context>,
  collector: NewsCollector,
): void {
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

    await ctx.reply("🔄 Đang tiến hành thu thập tin tức mới bằng AI...");

    try {
      const newArticles = await collector.collect();

      if (newArticles.length === 0) {
        await ctx.reply("Đã hoàn tất kiểm tra. Không có tin tức mới nào.");
        return;
      }

      // Sắp xếp các bài viết mới thu thập được theo tầm quan trọng giảm dần và lấy tối đa 10 bài
      const sortedNew = [...newArticles].sort((a, b) => {
        const scoreA =
          typeof a.importanceScore === "number" ? a.importanceScore : 50;
        const scoreB =
          typeof b.importanceScore === "number" ? b.importanceScore : 50;
        return scoreB - scoreA;
      });
      const topNew = sortedNew.slice(0, 10);

      await ctx.reply(
        `Đã thu thập thêm ${newArticles.length} bài viết mới. Đang gửi ${topNew.length} bài viết chất lượng nhất.`,
      );

      // Lấy danh sách người đăng ký nhận tin
      const subscribers = await SubscriberModel.find().lean().exec();
      if (subscribers.length > 0) {
        // Nhóm các bài viết thành các nhóm tối đa 5 bài
        const batches: (typeof topNew)[] = [];
        for (let i = 0; i < topNew.length; i += 5) {
          batches.push(topNew.slice(i, i + 5));
        }

        for (const batch of batches) {
          const message = formatArticlesBatch(batch);

          for (const sub of subscribers) {
            try {
              await bot.api.sendMessage(sub.chatId, message, {
                parse_mode: "HTML",
              });
            } catch (err) {
              console.error(
                `Không thể gửi tin nhắn đến chatId ${sub.chatId}:`,
                err,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("Lỗi khi chạy lệnh /sync:", error);
      await ctx.reply(
        "Tiến trình thu thập tin tức thất bại. Vui lòng kiểm tra lại cấu hình AI.",
      );
    }
  });
}
