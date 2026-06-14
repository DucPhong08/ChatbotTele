import { Bot } from "grammy";
import { env } from "../config/env";
import { NewsService } from "../news/news.service";
import { NewsCollector } from "../news/news.collector";
import { registerNewsCommand } from "./commands/news.command";
import { registerPingCommand } from "./commands/ping.command";
import { registerStartCommand } from "./commands/start.command";
import { registerStatsCommand } from "./commands/stats.command";
import { registerStopCommand } from "./commands/stop.command";
import { registerSyncCommand } from "./commands/sync.command";
import { registerFeedCommands } from "./commands/feed.command";
import { registerCategoryCommand } from "./commands/category.command";
import { registerSettingsCommand } from "./commands/settings.command";
import { registerFeedbackCommand } from "./commands/feedback.command";
import { handleBotError } from "./middlewares/error.middleware";

export function createBot(newsService: NewsService, newsCollector: NewsCollector): Bot {
  const bot = new Bot(env.botToken);

  registerStartCommand(bot, newsService);
  registerStopCommand(bot);
  registerNewsCommand(bot, newsService);
  registerSyncCommand(bot, newsCollector);
  registerPingCommand(bot);
  registerStatsCommand(bot);
  registerFeedCommands(bot);
  registerCategoryCommand(bot);
  registerSettingsCommand(bot, newsCollector);
  registerFeedbackCommand(bot);
  bot.catch(handleBotError);

  // Thiết lập menu Lệnh (Command Menu) tự động trên Telegram
  void bot.api.setMyCommands([
    { command: "start", description: "Start the bot & show help guide" },
    { command: "news", description: "Get latest tech articles" },
    { command: "category", description: "Filter news topics using AI" },
    { command: "settings", description: "Configure language & digest preferences" },
    { command: "submitfeed", description: "Suggest a new RSS source" },
    { command: "feedback", description: "Send feedback to the administrators" },
    { command: "stop", description: "Stop receiving news" },
  ]);

  void bot.api.setMyCommands(
    [
      { command: "start", description: "Bắt đầu & xem hướng dẫn" },
      { command: "news", description: "Xem tin tức công nghệ mới nhất" },
      { command: "category", description: "Lọc chủ đề tin bằng AI" },
      { command: "settings", description: "Cấu hình ngôn ngữ & nhận tin tổng hợp" },
      { command: "submitfeed", description: "Đề xuất nguồn tin RSS mới" },
      { command: "feedback", description: "Gửi góp ý, phản hồi cho quản trị viên" },
      { command: "stop", description: "Hủy nhận tin tự động" },
    ],
    { language_code: "vi" },
  );

  // Thiết lập menu Lệnh riêng biệt cho Admin (Chỉ Admin nhìn thấy các lệnh quản trị)
  for (const adminId of env.adminChatIds) {
    void bot.api.setMyCommands(
      [
        { command: "start", description: "Bắt đầu & xem hướng dẫn" },
        { command: "news", description: "Xem tin tức công nghệ mới nhất" },
        { command: "category", description: "Lọc chủ đề tin bằng AI" },
        { command: "settings", description: "Cấu hình ngôn ngữ & nhận tin tổng hợp" },
        { command: "submitfeed", description: "Đề xuất nguồn tin RSS mới" },
        { command: "feedback", description: "Gửi góp ý, phản hồi cho quản trị viên" },
        { command: "stop", description: "Hủy nhận tin tự động" },
        // Lệnh admin
        { command: "addfeed", description: "[ADMIN] Thêm nguồn RSS ngay lập tức" },
        { command: "sync", description: "[ADMIN] Cào tin & gửi tin tức thì" },
        { command: "stats", description: "[ADMIN] Xem thống kê hệ thống" },
        { command: "ping", description: "[ADMIN] Kiểm tra hoạt động bot" },
      ],
      { scope: { type: "chat", chat_id: adminId } },
    );
  }

  return bot;
}
