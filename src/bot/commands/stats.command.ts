import { type Bot, type Context } from "grammy";
import { NewsModel } from "../../news/news.model";
import { SubscriberModel } from "../subscriber.model";
import { env } from "../../config/env";
import { escapeHtml } from "../../news/news.formatter";

function isAdmin(chatId: number): boolean {
  return env.adminChatIds.includes(chatId);
}

function getActiveAiModel(): string {
  switch (env.aiProvider) {
    case "gemini":
      return env.geminiModel;
    case "openai":
      return env.openaiModel;
    case "groq":
      return env.groqModel;
    case "openrouter":
      return env.openrouterModel;
    case "cerebras":
      return env.cerebrasModel;
    case "ollama":
      return env.ollamaModel;
    default:
      return "Không rõ";
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days} ngày ${hours} giờ ${minutes} phút`;
  }

  if (hours > 0) {
    return `${hours} giờ ${minutes} phút`;
  }

  return `${minutes} phút`;
}

export function registerStatsCommand(bot: Bot<Context>): void {
  bot.command("stats", async (ctx) => {
    const chatId = ctx.chat.id;

    if (env.adminChatIds.length === 0) {
      await ctx.reply("Lệnh /stats chưa được cấu hình admin. Vui lòng thiết lập ADMIN_CHAT_IDS.");
      return;
    }

    if (!isAdmin(chatId)) {
      await ctx.reply("Bạn không có quyền chạy lệnh /stats.");
      return;
    }

    try {
      const now = Date.now();

      const last24hDate = new Date(now - 24 * 60 * 60 * 1000);
      const last7dDate = new Date(now - 7 * 24 * 60 * 60 * 1000);

      const [
        totalNews,
        newsLast24h,
        newsLast7d,
        activeSubscriberCount,
        totalSubscriberCount,
        latestArticle,
      ] = await Promise.all([
        NewsModel.countDocuments(),
        NewsModel.countDocuments({
          publishedAt: { $gte: last24hDate },
        }),
        NewsModel.countDocuments({
          publishedAt: { $gte: last7dDate },
        }),
        SubscriberModel.countDocuments({
          isActiveAI: { $ne: false },
        }),
        SubscriberModel.countDocuments(),
        NewsModel.findOne()
          .sort({ publishedAt: -1 })
          .select("title source publishedAt")
          .lean<{
            title?: string;
            source?: string;
            publishedAt?: Date;
          }>()
          .exec(),
      ]);

      const activeModel = getActiveAiModel();
      const appEnv = process.env.APP_ENV || "local";
      const uptime = formatUptime(process.uptime());

      let latestArticleText = "Chưa có bài viết";
      if (latestArticle) {
        const dateStr = latestArticle.publishedAt
          ? new Date(latestArticle.publishedAt).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
            })
          : "Không rõ ngày";
        latestArticleText = `${escapeHtml(latestArticle.title || "Không có tiêu đề")} (${escapeHtml(
          latestArticle.source || "Không rõ nguồn",
        )} | ${dateStr})`;
      }

      const statsText = [
        "<b>THỐNG KÊ BOT</b>",
        "────────────────",
        `<b>Tổng bài viết trong DB:</b> ${totalNews}`,
        `<b>Bài mới trong 24h:</b> ${newsLast24h}`,
        `<b>Bài mới trong 7 ngày:</b> ${newsLast7d}`,
        `<b>Subscriber đang hoạt động:</b> ${activeSubscriberCount}`,
        `<b>Tổng subscriber:</b> ${totalSubscriberCount}`,
        "────────────────",
        `<b>AI Provider:</b> ${escapeHtml(env.aiProvider)}`,
        `<b>AI Model:</b> <code>${escapeHtml(activeModel)}</code>`,
        `<b>Môi trường:</b> <code>${escapeHtml(appEnv)}</code>`,
        `<b>Uptime:</b> ${escapeHtml(uptime)}`,
        "────────────────",
        `<b>Bài mới nhất:</b> ${latestArticleText}`,
      ].join("\n");

      await ctx.reply(statsText, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      console.error("[StatsCommand] Lỗi khi xử lý lệnh /stats:", error);
      await ctx.reply("Đã xảy ra lỗi khi lấy thống kê. Vui lòng kiểm tra log server.");
    }
  });
}
