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
          const score = typeof article.importanceScore === "number" ? article.importanceScore : 50;
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
          const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
          const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
          return scoreB - scoreA;
        });
        const topNew = sortedNew.slice(0, 5);

        // Lấy tất cả người dùng đã đăng ký nhận tin
        const subscribers = await SubscriberModel.find({ isActiveAI: { $ne: false } })
          .lean()
          .exec();

        if (subscribers.length > 0) {
          console.log(`Đang gửi tự động tin tức mới tới ${subscribers.length} người dùng...`);

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
                userArticles = await AIService.filterArticlesByPrompt(
                  userArticles,
                  sub.customPrompt,
                );
                if (userArticles.length === 0) {
                  continue;
                }
              }

              const lang = sub.language || "vi";
              const message = formatArticlesBatch(userArticles, botUsername, preferred, lang);
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
              console.error(`Không thể gửi tin nhắn tự động đến chatId ${sub.chatId}:`, err);
              // Tự động dọn dẹp subscriber nếu họ đã chặn bot hoặc chat không còn tồn tại
              const isBlocked =
                err?.description?.includes("blocked") ||
                err?.description?.includes("chat not found") ||
                err?.code === 403;
              if (isBlocked) {
                console.log(
                  `[Auto-cleanup] Đang đánh dấu subscriber đã chặn bot làm không hoạt động: ${sub.chatId}`,
                );
                await SubscriberModel.updateOne({ chatId: sub.chatId }, { isActiveAI: false });
              }
            }
          }
        }
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
