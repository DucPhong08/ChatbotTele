import { type Bot, type Context } from "grammy";
import { SubscriberModel } from "../subscriber.model";

export function registerStartCommand(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;

    try {
      // Đăng ký nhận tin bằng cách lưu chatId vào database
      await SubscriberModel.updateOne(
        { chatId },
        { $setOnInsert: { chatId } },
        { upsert: true },
      );

      await ctx.reply(
        "Chào mừng bạn đến với kênh tin tức công nghệ!\n\n" +
          "Bạn đã đăng ký nhận tin tự động thành công. Mỗi khi có tin tức mới nhất từ Hacker News, Dev.to hay GitHub Blog, tôi sẽ tự động gửi ngay cho bạn.\n\n" +
          "Bạn cũng có thể dùng lệnh /news để xem tin tức mới nhất, hoặc /stop để hủy nhận tin tự động.",
      );
    } catch (error) {
      console.error("Lỗi khi đăng ký người dùng:", error);
      await ctx.reply(
        "Đã xảy ra lỗi khi đăng ký nhận tin. Vui lòng thử lại sau!",
      );
    }
  });
}
