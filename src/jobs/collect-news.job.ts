import cron, { type ScheduledTask } from "node-cron";
import { type Bot, type Context } from "grammy";
import { NewsCollector } from "../news/news.collector";
import { SubscriberModel } from "../bot/subscriber.model";
import { formatArticlesBatch } from "../news/news.formatter";
import { NewsModel } from "../news/news.model";

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
        // Sắp xếp các bài viết mới thu thập được theo tầm quan trọng giảm dần và lấy tối đa 10 bài
        const sortedNew = [...newArticles].sort((a, b) => {
          const scoreA = typeof a.importanceScore === "number" ? a.importanceScore : 50;
          const scoreB = typeof b.importanceScore === "number" ? b.importanceScore : 50;
          return scoreB - scoreA;
        });
        const topNew = sortedNew.slice(0, 10);

        // Lấy tất cả người dùng đã đăng ký nhận tin
        const subscribers = await SubscriberModel.find().lean().exec();

        if (subscribers.length > 0) {
          console.log(
            `Đang gửi tự động ${topNew.length} bài viết mới tới ${subscribers.length} người dùng...`,
          );

          // Nhóm các bài viết thành các nhóm tối đa 5 bài
          const batches: typeof topNew[] = [];
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
                  `Không thể gửi tin nhắn tự động đến chatId ${sub.chatId}:`,
                  err,
                );
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
        console.log("Đã có tin tức trong DB. Bỏ qua thu thập lúc khởi động để tránh bị khóa IP (Rate Limit).");
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
