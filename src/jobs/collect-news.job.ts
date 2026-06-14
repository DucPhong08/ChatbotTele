import cron, { type ScheduledTask } from "node-cron";
import { type Bot, type Context, InlineKeyboard } from "grammy";
import { NewsCollector } from "../news/news.collector";
import { SubscriberModel } from "../bot/subscriber.model";
import { formatArticlesBatch } from "../news/news.formatter";
import { NewsModel } from "../news/news.model";
import { env } from "../config/env";
import { AIService } from "../ai/ai.service";

let activeJob: ScheduledTask | null = null;
let activeCollector: NewsCollector | null = null;
let activeBot: Bot<Context> | null = null;
let isCollecting = false;

const collect = async (): Promise<void> => {
  if (!activeCollector || !activeBot) return;
  if (isCollecting) {
    console.warn(
      "Tiến trình thu thập tin tức đang chạy, bỏ qua lượt quét này để tránh chạy song song.",
    );
    return;
  }
  isCollecting = true;
  try {
    const newArticles = await activeCollector.collect();
    console.log(
      `Tiến trình thu thập tin tức hoàn tất. Đã thêm ${newArticles.length} bài viết mới.`,
    );

    if (newArticles.length > 0) {
      const notifyArticles = newArticles.filter((article) => {
        const score = Number.isInteger(article.importanceScore) ? article.importanceScore! : 50;
        return score >= env.notificationMinScore;
      });

      if (notifyArticles.length === 0) {
        console.log(`Không có bài mới nào đạt ngưỡng gửi tự động ${env.notificationMinScore}/100.`);
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
      let botUsername = "";
      if (activeBot.isInited()) {
        botUsername = activeBot.botInfo.username;
      } else {
        await activeBot.init();
        botUsername = activeBot.botInfo.username;
      }

      // Gọi helper broadcastToSubscribers để gửi tin an toàn (chống Rate Limit) cho người nhận Real-time
      await import("../bot/telegram.broadcaster").then(async ({ broadcastToSubscribers }) => {
        await broadcastToSubscribers(activeBot!, notifyArticles, topNew, botUsername || "", {
          isActiveAI: { $ne: false },
          digestMode: { $ne: true },
        });
      });
    }
  } catch (error) {
    console.error("Tiến trình thu thập tin tức thất bại", error);
    if (env.adminChatIds.length > 0 && activeBot) {
      const errMsg = error instanceof Error ? error.message : String(error);
      for (const adminId of env.adminChatIds) {
        await activeBot.api
          .sendMessage(
            adminId,
            `❌ *[NEWS CRON ERROR]*\nTiến trình thu thập tin tức tự động thất bại.\n\n*Chi tiết lỗi:*\n\`${errMsg}\``,
            { parse_mode: "Markdown" },
          )
          .catch((err) => {
            console.error(`Không thể gửi báo lỗi đến admin ${adminId}:`, err);
          });
      }
    }
  } finally {
    isCollecting = false;
  }
};

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
    if (env.adminChatIds.length > 0 && activeBot) {
      const errMsg = err instanceof Error ? err.message : String(err);
      for (const adminId of env.adminChatIds) {
        await activeBot.api
          .sendMessage(
            adminId,
            `❌ *[NEWS STARTUP ERROR]*\nLỗi khi kiểm tra số lượng bài viết lúc khởi động.\n\n*Chi tiết lỗi:*\n\`${errMsg}\``,
            { parse_mode: "Markdown" },
          )
          .catch((e) => {
            console.error(`Không thể gửi báo lỗi đến admin ${adminId}:`, e);
          });
      }
    }
  }
};

export function startCollectNewsJob(
  collector: NewsCollector,
  cronExpression: string,
  bot: Bot<Context>,
): ScheduledTask {
  activeCollector = collector;
  activeBot = bot;

  void runStartupCollect();

  activeJob = cron.schedule(cronExpression, () => {
    void collect();
  });
  return activeJob;
}

export function rescheduleCollectNewsJob(newCronExpression: string): void {
  if (activeJob) {
    try {
      activeJob.stop();
      console.log(`[NewsCron] Stopped existing collect news job.`);
    } catch (err) {
      console.error("[NewsCron] Error stopping existing collect news job:", err);
    }
  }
  if (activeCollector && activeBot) {
    console.log(`[NewsCron] Scheduling new collect news job with expression: ${newCronExpression}`);
    activeJob = cron.schedule(newCronExpression, () => {
      void collect();
    });
  }
}
