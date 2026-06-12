import cron, { type ScheduledTask } from "node-cron";
import { type Bot, type Context, InlineKeyboard } from "grammy";
import { NewsCollector } from "../news/news.collector";
import { SubscriberModel } from "../bot/subscriber.model";
import { formatArticlesBatch } from "../news/news.formatter";
import { NewsModel } from "../news/news.model";
import { env } from "../config/env";
import { AIService } from "../ai/ai.service";

export function startCollectNewsJob(
  collector: NewsCollector,
  cronExpression: string,
  bot: Bot<Context>,
): ScheduledTask {
  const collect = async (): Promise<void> => {
    try {
      const newArticles = await collector.collect();
      console.log(
        `Tiến trình thu thập tin tức hoàn tất. Đã thêm ${newArticles.length} bài viết mới.`,
      );

      if (newArticles.length > 0) {
        const notifyArticles = newArticles.filter((article) => {
          const score = Number.isInteger(article.importanceScore) ? article.importanceScore! : 50;
          return score >= env.notificationMinScore;
        });

        if (notifyArticles.length === 0) {
          console.log(
            `Không có bài mới nào đạt ngưỡng gửi tự động ${env.notificationMinScore}/100.`,
          );
          return;
        }

        // Sắp xếp các bài viết mới thu thập được theo tầm quan trọng giảm dần và lấy tối đa 5 bài
        const sortedNew = [...notifyArticles].sort((a, b) => {
          const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
          const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;
          if (scoreA !== scoreB) return scoreB - scoreA;
          const commentsA = Number.isInteger(a.commentCount) ? a.commentCount! : 0;
          const commentsB = Number.isInteger(b.commentCount) ? b.commentCount! : 0;
          return commentsB - commentsA;
        });
        const topNew = sortedNew.slice(0, 10);

        // Lấy thông tin username của bot nếu chưa có
        let botUsername = bot.botInfo?.username;
        if (!botUsername) {
          try {
            const me = await bot.api.getMe();
            botUsername = me.username;
          } catch (err) {
            console.warn("Không thể lấy username bot:", err);
            botUsername = "";
          }
        }

        // Gọi helper broadcastToSubscribers để gửi tin an toàn (chống Rate Limit) cho người nhận Real-time
        await import("../bot/telegram.broadcaster").then(async ({ broadcastToSubscribers }) => {
          await broadcastToSubscribers(bot, notifyArticles, topNew, botUsername || "", {
            isActiveAI: { $ne: false },
            digestMode: { $ne: true },
          });
        });
      }
    } catch (error) {
      console.error("Tiến trình thu thập tin tức thất bại", error);
    }
  };

  // Chạy một lần lúc khởi động (chỉ chạy nếu DB chưa có bài viết nào để tránh bị spam/block IP khi restart dev server)
  const runStartupCollect = async () => {
    try {
      const count = await NewsModel.countDocuments();
      if (count === 0) {
        console.log("Database trống, đang chạy thu thập tin lần đầu...");
        void collect();
      } else {
        console.log(
          "Đã có tin tức trong DB. Bỏ qua thu thập lúc khởi động để tránh bị khóa IP (Rate Limit).",
        );
      }
    } catch (err) {
      console.error("Lỗi khi kiểm tra số lượng bài viết lúc khởi động:", err);
    }
  };
  void runStartupCollect();

  return cron.schedule(cronExpression, () => {
    void collect();
  });
}
