import { type Bot, type Context, InlineKeyboard } from "grammy";
import { env } from "../../config/env";
import { SubscriberModel } from "../subscriber.model";
import { FeedbackModel } from "../feedback.model";

export function registerFeedbackCommand(bot: Bot<Context>): void {
  const handler = async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Lấy cấu hình ngôn ngữ của user
    const sub = await SubscriberModel.findOne({ chatId }).lean();
    const lang = sub?.language || "vi";
    const isEn = lang === "en";

    const feedbackContent = String(ctx.match || "").trim();

    if (!feedbackContent) {
      const usageMessage = isEn
        ? `<b>📥 Send Feedback to Admin</b>\n` +
          `────────────────\n` +
          `Please enter your feedback or suggestion after the command.\n\n` +
          `<b>Usage:</b> <code>/feedback [your message]</code>\n` +
          `<b>Example:</b> <code>/feedback Please add Tinhte.vn feed!</code>`
        : `<b>📥 Gửi góp ý đến Quản trị viên</b>\n` +
          `────────────────\n` +
          `Vui lòng nhập nội dung góp ý của bạn sau câu lệnh.\n\n` +
          `<b>Cách dùng:</b> <code>/feedback [nội dung góp ý]</code> hoặc <code>/gopy [nội dung]</code>\n` +
          `<b>Ví dụ:</b> <code>/gopy Thêm nguồn tinhte.vn nhé!</code>`;

      await ctx.reply(usageMessage, { parse_mode: "HTML" });
      return;
    }

    try {
      const username = ctx.from?.username;
      const firstName = ctx.from?.first_name || "";
      const lastName = ctx.from?.last_name || "";
      const displayName = [firstName, lastName].filter(Boolean).join(" ");
      const userDisplay = username ? `@${username}` : displayName || `ID: ${chatId}`;

      // 1. Lưu góp ý vào Database
      const feedback = await FeedbackModel.create({
        chatId,
        username: username || "",
        name: displayName || "Ẩn danh",
        message: feedbackContent,
        status: "pending",
      });

      // 2. Tạo nút bấm cho admin liên hệ trực tiếp và đánh dấu đã xử lý
      const keyboard = new InlineKeyboard();
      if (username) {
        keyboard.url(isEn ? "✉️ Contact" : "✉️ Liên hệ", `https://t.me/${username}`);
      } else {
        keyboard.url(isEn ? "✉️ Open Chat" : "✉️ Mở Chat", `tg://user?id=${chatId}`);
      }
      keyboard.text(isEn ? "✅ Mark Processed" : "✅ Đã xử lý", `resolve_fb_${feedback._id}`);

      const adminMessage =
        `<b>📥 GÓP Ý MỚI TỪ NGƯỜI DÙNG (PENDING)</b>\n` +
        `────────────────\n` +
        `• <b>Người gửi:</b> ${userDisplay} (ID: <code>${chatId}</code>)\n` +
        `• <b>Nội dung:</b>\n<i>${feedbackContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>`;

      // Gửi cho tất cả admin
      for (const adminId of env.adminChatIds) {
        try {
          await bot.api.sendMessage(adminId, adminMessage, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          });
        } catch (err) {
          console.error(`Không thể gửi góp ý cho Admin ${adminId}:`, err);
        }
      }

      const responseMessage = isEn
        ? `✅ <b>Feedback Sent!</b>\nThank you for your suggestion. It has been recorded and the administrators have been notified.`
        : `✅ <b>Đã gửi góp ý thành công!</b>\nCảm ơn đóng góp của bạn. Nội dung đã được lưu lại và chuyển tới Ban quản trị.`;

      await ctx.reply(responseMessage, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Lỗi khi gửi góp ý:", error);
      await ctx.reply(
        isEn
          ? "Failed to send feedback. Please try again later."
          : "Đã xảy ra lỗi khi gửi góp ý. Vui lòng thử lại sau.",
      );
    }
  };

  bot.command(["feedback", "gopy"], handler);

  // Admin click nút bấm "Đã xử lý" trên tin nhắn góp ý
  bot.callbackQuery(/resolve_fb_(.+)/, async (ctx) => {
    const adminChatId = ctx.from?.id;
    if (!adminChatId) return;

    const isAdmin = env.adminChatIds.includes(adminChatId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({ text: "Bạn không có quyền thực hiện hành động này." });
      return;
    }

    const feedbackId = ctx.match[1];
    try {
      const feedback = await FeedbackModel.findById(feedbackId);
      if (!feedback) {
        await ctx.editMessageText("Không tìm thấy thông tin góp ý này trong database.");
        await ctx.answerCallbackQuery();
        return;
      }

      if (feedback.status === "processed") {
        await ctx.answerCallbackQuery({ text: "Góp ý này đã được xử lý từ trước." });
        return;
      }

      feedback.status = "processed";
      feedback.repliedBy = adminChatId;
      feedback.repliedAt = new Date();
      await feedback.save();

      const adminUser = ctx.from?.username
        ? `@${ctx.from.username}`
        : ctx.from?.first_name || "Admin";

      // Cập nhật giao diện tin nhắn góp ý của Admin để bỏ nút bấm "Đã xử lý"
      const userDisplay = feedback.username
        ? `@${feedback.username}`
        : feedback.name || `ID: ${feedback.chatId}`;
      const originalMessageText =
        `<b>📥 GÓP Ý ĐÃ XỬ LÝ (RESOLVED)</b>\n` +
        `────────────────\n` +
        `• <b>Người gửi:</b> ${userDisplay} (ID: <code>${feedback.chatId}</code>)\n` +
        `• <b>Nội dung:</b>\n<i>${feedback.message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>\n\n` +
        `✅ <b>THÔNG TIN XỬ LÝ:</b>\n` +
        `• <b>Người duyệt:</b> ${adminUser}\n` +
        `• <b>Thời gian:</b> ${new Date().toLocaleTimeString("vi-VN")} ${new Date().toLocaleDateString("vi-VN")}`;

      const keyboard = new InlineKeyboard();
      if (feedback.username) {
        keyboard.url("✉️ Liên hệ", `https://t.me/${feedback.username}`);
      } else {
        keyboard.url("✉️ Mở Chat", `tg://user?id=${feedback.chatId}`);
      }

      await ctx.editMessageText(originalMessageText, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      await ctx.answerCallbackQuery({ text: "Đã đánh dấu đã xử lý thành công!" });
    } catch (error) {
      console.error("Lỗi khi cập nhật trạng thái góp ý:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi hệ thống khi cập nhật trạng thái." });
    }
  });
}
