import { type Bot, type Context, InlineKeyboard } from "grammy";
import { NewsCollector } from "../../news/news.collector";
import { SubscriberModel } from "../subscriber.model";
import { formatArticlesBatch } from "../../news/news.formatter";
import { env } from "../../config/env";
import { AIService } from "../../ai/ai.service";

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

    await ctx.reply("Đang tiến hành thu thập tin tức mới bằng AI...");

    try {
      const newArticles = await collector.collect();

      if (newArticles.length === 0) {
        await ctx.reply("Đã hoàn tất kiểm tra. Không có tin tức mới nào.");
        return;
      }

      const notifyArticles = newArticles.filter((article) => {
        const score = typeof article.importanceScore === "number" ? article.importanceScore : 50;
        return score >= env.notificationMinScore;
      });

      if (notifyArticles.length === 0) {
        await ctx.reply(
          `Đã thu thập thêm ${newArticles.length} bài viết mới, nhưng chưa có bài nào đạt ngưỡng gửi ${env.notificationMinScore}/100.`,
        );
        return;
      }

      // Sắp xếp các bài viết mới thu thập được theo tầm quan trọng giảm dần và lấy tối đa 5 bài
      const sortedNew = [...notifyArticles].sort((a, b) => {
        const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
        const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
        return scoreB - scoreA;
      });
      const topNew = sortedNew.slice(0, 5);

      await ctx.reply(
        `Đã thu thập thêm ${newArticles.length} bài viết mới. Tiến hành gửi tin theo sở thích của từng người dùng...`,
      );

      // Lấy danh sách người đăng ký nhận tin
      const subscribers = await SubscriberModel.find().lean().exec();
      if (subscribers.length > 0) {
        for (const sub of subscribers) {
          try {
            const preferred =
              sub.preferredCategories && sub.preferredCategories.length > 0
                ? sub.preferredCategories
                : ["all"];
            let userArticles = topNew;

            if (!preferred.includes("all")) {
              const filtered = notifyArticles.filter(
                (a) =>
                  a.category &&
                  preferred.map((p) => p.toLowerCase()).includes(a.category.toLowerCase()),
              );
              if (filtered.length === 0) {
                // Không có bài mới nào thuộc thể loại ưa thích của user này
                continue;
              }
              userArticles = [...filtered]
                .sort((a, b) => {
                  const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
                  const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
                  return scoreB - scoreA;
                })
                .slice(0, 5);
            }

            // Lọc bổ sung bằng AI nếu người dùng có custom prompt và không chọn "Tất cả"
            if (sub.customPrompt && !preferred.includes("all")) {
              userArticles = await AIService.filterArticlesByPrompt(userArticles, sub.customPrompt);
              if (userArticles.length === 0) {
                continue;
              }
            }

            const lang = sub.language || "vi";
            const message = formatArticlesBatch(userArticles, ctx.me.username, preferred, lang);
            const keyboard = new InlineKeyboard();
            if (userArticles.length === 5) {
              const nextLabel = lang === "en" ? "▶️ Next" : "▶️ Sau";
              keyboard.text(nextLabel, "news_page_2");
            }

            await bot.api.sendMessage(sub.chatId, message, {
              parse_mode: "HTML",
              reply_markup: keyboard,
            });
          } catch (err: any) {
            console.error(`Không thể gửi tin nhắn đến chatId ${sub.chatId}:`, err);
            // Tự động dọn dẹp subscriber nếu họ đã chặn bot hoặc chat không còn tồn tại
            const isBlocked =
              err?.description?.includes("blocked") ||
              err?.description?.includes("chat not found") ||
              err?.code === 403;
            if (isBlocked) {
              console.log(
                `[Auto-cleanup] Đang xóa subscriber đã chặn bot hoặc chat không tồn tại: ${sub.chatId}`,
              );
              await SubscriberModel.deleteOne({ chatId: sub.chatId });
            }
          }
        }
      }
    } catch (error) {
      console.error("Lỗi khi chạy lệnh /sync:", error);
      await ctx.reply("Tiến trình thu thập tin tức thất bại. Vui lòng kiểm tra lại cấu hình AI.");
    }
  });
}
