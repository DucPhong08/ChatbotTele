import cron, { type ScheduledTask } from "node-cron";
import { type Bot, type Context } from "grammy";
import { NewsModel } from "../news/news.model";
import { broadcastToSubscribers } from "../bot/telegram.broadcaster";
import { type NewsView } from "../types/news";
import { env } from "../config/env";

export function startDigestJob(bot: Bot<Context>, cronExpression = "0 * * * *"): ScheduledTask {
  const sendDigest = async (): Promise<void> => {
    try {
      // 1. Tính toán giờ hiện tại theo múi giờ Việt Nam (GMT+7)
      const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
      const hours = String(vnTime.getUTCHours()).padStart(2, "0");
      const currentTimeStr = `${hours}:00`;

      console.log(
        `[DigestJob] Bắt đầu chạy quét bản tin tổng hợp cho khung giờ: ${currentTimeStr}`,
      );

      // 2. Lấy danh sách tin tức trong 24 giờ qua đạt tiêu chuẩn điểm quan trọng
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const latestArticles = await NewsModel.find({
        importanceScore: { $gte: env.notificationMinScore },
        publishedAt: { $gte: cutoff },
      })
        .lean<NewsView[]>()
        .exec();

      if (latestArticles.length === 0) {
        console.log(
          "[DigestJob] Không có tin tức mới nào trong 24 giờ qua để gửi bản tin tổng hợp.",
        );
        return;
      }

      // Sắp xếp các bài viết theo tầm quan trọng giảm dần
      const sortedArticles = [...latestArticles].sort((a, b) => {
        const scoreA = Number.isInteger(a.importanceScore) ? a.importanceScore! : 50;
        const scoreB = Number.isInteger(b.importanceScore) ? b.importanceScore! : 50;
        if (scoreA !== scoreB) return scoreB - scoreA;
        const commentsA = Number.isInteger(a.commentCount) ? a.commentCount! : 0;
        const commentsB = Number.isInteger(b.commentCount) ? b.commentCount! : 0;
        return commentsB - commentsA;
      });

      const topArticles = sortedArticles.slice(0, 10);

      // Lấy username của bot
      let botUsername = bot.botInfo?.username;
      if (!botUsername) {
        try {
          const me = await bot.api.getMe();
          botUsername = me.username;
        } catch (err) {
          botUsername = "";
        }
      }

      // 3. Gọi broadcaster để gửi tin tức cho các user có digestMode = true và digestTime khớp giờ hiện tại
      await broadcastToSubscribers(bot, sortedArticles, topArticles, botUsername || "", {
        isActiveAI: { $ne: false },
        digestMode: true,
        digestTime: currentTimeStr,
      });
    } catch (error) {
      console.error("[DigestJob] Lỗi tiến trình gửi Bản tin tổng hợp:", error);
    }
  };

  return cron.schedule(cronExpression, () => {
    void sendDigest();
  });
}
