import { type Bot, type Context, InlineKeyboard } from "grammy";
import Parser from "rss-parser";
import { FeedModel } from "../../news/feed.model";
import { env } from "../../config/env";

const parser = new Parser({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
});

function convertUrlToRss(inputUrl: string): { url: string; sourceName: string } | null {
  const url = inputUrl.trim();
  const rsshub = env.rsshubUrl.replace(/\/$/, "");

  // 1. Kiểm tra nếu là URL Facebook
  if (url.includes("facebook.com")) {
    if (url.includes("profile.php")) {
      const match = url.match(/[?&]id=(\d+)/);
      if (match) {
        return {
          url: `${rsshub}/facebook/page/${match[1]}`,
          sourceName: `Facebook Page ${match[1]}`,
        };
      }
    }
    if (url.includes("/groups/")) {
      const match = url.match(/\/groups\/([^\/?#]+)/);
      if (match) {
        return {
          url: `${rsshub}/facebook/group/${match[1]}`,
          sourceName: `Facebook Group ${match[1]}`,
        };
      }
    }
    const cleanedPath = url.replace(/\/$/, "").split("?")[0];
    const parts = cleanedPath.split("/");
    const pageName = parts[parts.length - 1];
    if (pageName && pageName !== "facebook.com" && pageName !== "www.facebook.com") {
      return {
        url: `${rsshub}/facebook/page/${pageName}`,
        sourceName: `Facebook Page ${pageName}`,
      };
    }
  }

  // 2. Kiểm tra nếu là URL Threads
  if (url.includes("threads.net")) {
    const cleanedPath = url.replace(/\/$/, "").split("?")[0];
    const parts = cleanedPath.split("/");
    let username = parts[parts.length - 1];
    if (username.startsWith("@")) {
      username = username.slice(1);
    }
    if (username && username !== "threads.net" && username !== "www.threads.net") {
      return {
        url: `${rsshub}/threads/user/${username}`,
        sourceName: `Threads User @${username}`,
      };
    }
  }

  // 3. Kiểm tra nếu là URL Instagram
  if (url.includes("instagram.com")) {
    const cleanedPath = url.replace(/\/$/, "").split("?")[0];
    const parts = cleanedPath.split("/");
    let username = parts[parts.length - 1];
    if (username.startsWith("@")) {
      username = username.slice(1);
    }
    if (username && username !== "instagram.com" && username !== "www.instagram.com") {
      return {
        url: `${rsshub}/instagram/user/${username}`,
        sourceName: `Instagram User @${username}`,
      };
    }
  }

  // 4. Nếu là link RSS XML trực tiếp hoặc URL bình thường khác
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return {
      url: url,
      sourceName: "Nguồn tin RSS",
    };
  }

  return null;
}

export function registerFeedCommands(bot: Bot<Context>): void {
  // 1. Lệnh /addfeed (Chỉ Admin): Thêm nguồn hoạt động ngay lập tức
  bot.command("addfeed", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const isAdmin = env.adminChatIds.includes(chatId);
    if (!isAdmin) {
      await ctx.reply("Lệnh này chỉ dành cho Admin hệ thống.");
      return;
    }

    const inputUrl = String(ctx.match || "").trim();
    if (!inputUrl) {
      await ctx.reply(
        "Vui lòng nhập đường dẫn trang web hoặc nguồn RSS. Ví dụ:\n<code>/addfeed https://www.facebook.com/AIoT.CNTT.PTIT</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    const converted = convertUrlToRss(inputUrl);
    if (!converted) {
      await ctx.reply(
        "Đường dẫn không hợp lệ. Vui lòng gửi URL trang Facebook, Threads, Instagram hoặc link RSS.",
      );
      return;
    }

    try {
      await ctx.reply("Đang kiểm tra và tải thông tin nguồn tin...");
      const parsedFeed = await parser.parseURL(converted.url);
      if (parsedFeed.title) {
        converted.sourceName = parsedFeed.title;
      }
    } catch (error) {
      console.log(
        `[Validation Warning] Không thể kết nối để kiểm tra RSS URL: ${converted.url}. Bot sẽ dùng thông tin phân tách tự động.`,
      );
    }

    try {
      // Lưu vào database ở trạng thái active
      const feed = await FeedModel.findOneAndUpdate(
        { url: converted.url },
        {
          source: converted.sourceName,
          url: converted.url,
          category: "general",
          skills: [],
          isActive: true,
          approvedBy: String(chatId),
        },
        { upsert: true, new: true },
      );

      await ctx.reply(
        `Đã thêm nguồn thành công và bắt đầu theo dõi!\n\n` +
          `• <b>Nguồn:</b> ${feed.source}\n` +
          `• <b>URL gốc:</b> <code>${inputUrl}</code>\n` +
          `• <b>URL RSS:</b> <code>${feed.url}</code>`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      console.error("Lỗi khi thêm nguồn tin:", error);
      await ctx.reply("Đã xảy ra lỗi khi lưu nguồn tin vào cơ sở dữ liệu.");
    }
  });

  // 2. Lệnh /submitfeed (User): Đề xuất thêm nguồn tin mới
  bot.command("submitfeed", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const inputUrl = String(ctx.match || "").trim();
    if (!inputUrl) {
      await ctx.reply(
        "Vui lòng cung cấp đường dẫn trang web hoặc nguồn RSS muốn đề xuất. Ví dụ:\n<code>/submitfeed https://www.facebook.com/AIoT.CNTT.PTIT</code>",
        { parse_mode: "HTML" },
      );
      return;
    }

    const converted = convertUrlToRss(inputUrl);
    if (!converted) {
      await ctx.reply(
        "Đường dẫn không hợp lệ. Vui lòng gửi URL trang Facebook, Threads, Instagram hoặc link RSS.",
      );
      return;
    }

    try {
      await ctx.reply("Đang xác thực nguồn tin...");
      const parsedFeed = await parser.parseURL(converted.url);
      if (parsedFeed.title) {
        converted.sourceName = parsedFeed.title;
      }
    } catch (error) {
      console.log(
        `[Validation Warning] Không thể kết nối để kiểm tra RSS URL: ${converted.url}. Bot sẽ dùng thông tin phân tách tự động.`,
      );
    }

    try {
      const feed = await FeedModel.findOneAndUpdate(
        { url: converted.url },
        {
          $setOnInsert: {
            source: converted.sourceName,
            url: converted.url,
            category: "general",
            skills: [],
            isActive: false,
            submittedBy: String(chatId),
          },
        },
        { upsert: true, new: true },
      );

      if (feed.isActive) {
        await ctx.reply("Nguồn tin này đã được duyệt và đang trong danh sách theo dõi rồi!");
        return;
      }

      await ctx.reply("Cảm ơn bạn! Đề xuất của bạn đã được gửi đến Admin phê duyệt.");

      // Gửi yêu cầu phê duyệt cho toàn bộ admin
      const keyboard = new InlineKeyboard()
        .text("Phê duyệt", `approve_feed_${feed._id}`)
        .text("Từ chối", `reject_feed_${feed._id}`);

      const adminMessage =
        `<b>ĐỀ XUẤT NGUỒN TIN MỚI PENDING</b>\n` +
        `────────────────\n` +
        `• <b>Người gửi:</b> @${ctx.from?.username || ctx.from?.first_name || "N/A"} (ID: ${chatId})\n` +
        `• <b>Tên nguồn:</b> ${feed.source}\n` +
        `• <b>Link RSS:</b> <code>${feed.url}</code>`;

      for (const adminId of env.adminChatIds) {
        await bot.api
          .sendMessage(adminId, adminMessage, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          })
          .catch((err) => {
            console.error(`Không thể gửi tin duyệt feed cho Admin ${adminId}:`, err);
          });
      }
    } catch (error) {
      console.error("Lỗi khi đề xuất nguồn tin:", error);
      await ctx.reply("Đã xảy ra lỗi khi đề xuất nguồn tin.");
    }
  });

  // 3. Xử lý khi Admin nhấn Approve
  bot.callbackQuery(/approve_feed_(.+)/, async (ctx) => {
    const adminChatId = ctx.from?.id;
    if (!adminChatId) return;

    const isAdmin = env.adminChatIds.includes(adminChatId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({ text: "Bạn không có quyền thực hiện hành động này." });
      return;
    }

    const feedId = ctx.match[1];
    try {
      const feed = await FeedModel.findById(feedId);
      if (!feed) {
        await ctx.editMessageText("Không tìm thấy nguồn đề xuất này nữa.");
        await ctx.answerCallbackQuery();
        return;
      }

      if (feed.isActive) {
        await ctx.editMessageText(`Nguồn tin <b>${feed.source}</b> đã được duyệt trước đó.`, {
          parse_mode: "HTML",
        });
        await ctx.answerCallbackQuery();
        return;
      }

      feed.isActive = true;
      feed.approvedBy = String(adminChatId);
      await feed.save();

      await ctx.editMessageText(
        `Đã phê duyệt nguồn tin <b>${feed.source}</b> thành công!\n` +
          `Nguồn tin này đã chính thức được bot giám sát.`,
        { parse_mode: "HTML" },
      );
      await ctx.answerCallbackQuery({ text: "Đã phê duyệt nguồn tin." });

      // Thông báo lại cho người dùng đề xuất
      if (feed.submittedBy) {
        await bot.api
          .sendMessage(
            feed.submittedBy,
            `Đề xuất nguồn tin <b>${feed.source}</b> của bạn đã được Admin phê duyệt và đưa vào danh sách giám sát! Cảm ơn bạn.`,
            { parse_mode: "HTML" },
          )
          .catch(() => {});
      }
    } catch (error) {
      console.error("Lỗi khi phê duyệt feed:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi hệ thống khi phê duyệt." });
    }
  });

  // 4. Xử lý khi Admin nhấn Reject
  bot.callbackQuery(/reject_feed_(.+)/, async (ctx) => {
    const adminChatId = ctx.from?.id;
    if (!adminChatId) return;

    const isAdmin = env.adminChatIds.includes(adminChatId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery({ text: "Bạn không có quyền thực hiện hành động này." });
      return;
    }

    const feedId = ctx.match[1];
    try {
      const feed = await FeedModel.findById(feedId);
      if (!feed) {
        await ctx.editMessageText("Không tìm thấy nguồn đề xuất này.");
        await ctx.answerCallbackQuery();
        return;
      }

      const sourceName = feed.source;
      const submittedBy = feed.submittedBy;

      await FeedModel.deleteOne({ _id: feedId });

      await ctx.editMessageText(`Đã từ chối và xóa đề xuất nguồn tin <b>${sourceName}</b>.`, {
        parse_mode: "HTML",
      });
      await ctx.answerCallbackQuery({ text: "Đã từ chối đề xuất." });

      // Thông báo cho người dùng
      if (submittedBy) {
        await bot.api
          .sendMessage(
            submittedBy,
            `Rất tiếc, đề xuất nguồn tin <b>${sourceName}</b> của bạn đã bị từ chối phê duyệt.`,
            { parse_mode: "HTML" },
          )
          .catch(() => {});
      }
    } catch (error) {
      console.error("Lỗi khi từ chối feed:", error);
      await ctx.answerCallbackQuery({ text: "Lỗi hệ thống khi từ chối." });
    }
  });
}
