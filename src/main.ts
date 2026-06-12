import { createBot } from "./bot/bot";
import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./db/mongo";
import { startCollectNewsJob } from "./jobs/collect-news.job";
import { startDigestJob } from "./jobs/digest.job";
import { NewsCollector } from "./news/news.collector";
import { NewsService } from "./news/news.service";
import { createFastifyServer } from "./server/fastify.server";

async function bootstrap(): Promise<void> {
  await connectMongo(env.mongoUri);

  const newsService = new NewsService();
  const newsCollector = new NewsCollector(newsService);
  const bot = createBot(newsService, newsCollector);

  const collectNewsJob = startCollectNewsJob(newsCollector, env.newsCron, bot);
  const digestJob = startDigestJob(bot);
  const server = createFastifyServer(bot, env.telegramMode);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Nhận tín hiệu ${signal}. Đang dừng ứng dụng...`);

    collectNewsJob.stop();
    digestJob.stop();
    await bot.stop();
    await server.close();
    await disconnectMongo();

    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await server.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`Máy chủ HTTP đang chạy tại cổng ${env.port}`);

  if (env.telegramMode === "webhook") {
    const webhookEndpoint = `${env.webhookUrl}/telegram/webhook`;

    try {
      await bot.api.setWebhook(webhookEndpoint);
      console.log(`Đã kích hoạt Telegram webhook tại: ${webhookEndpoint}`);
    } catch (error) {
      console.error(
        `Cảnh báo: Không thể cấu hình Telegram webhook (${webhookEndpoint}). Có thể do lỗi kết nối mạng:`,
        error,
      );
    }
    return;
  }

  try {
    await bot.api.deleteWebhook();
    console.log("Đã xóa Webhook cũ (nếu có)");
  } catch (error) {
    console.warn("Cảnh báo: Không thể xóa Telegram webhook (có thể do lỗi mạng):", error);
  }
  console.log("Đã kích hoạt Telegram long polling");

  void bot
    .start({
      onStart: (botInfo) => {
        console.log(`Telegram bot đã khởi động với tên @${botInfo.username}`);
      },
    })
    .catch((error) => {
      console.error(
        "Telegram long polling thất bại (vui lòng kiểm tra kết nối mạng đến api.telegram.org)",
        error,
      );
      void shutdown("polling-error");
    });
}

bootstrap().catch((error) => {
  console.error("Khởi động ứng dụng thất bại", error);
  process.exit(1);
});
