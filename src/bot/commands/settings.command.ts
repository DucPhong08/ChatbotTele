import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";
import { env } from "../../config/env";
import { NewsCollector } from "../../news/news.collector";
import { getSystemConfig, updateSystemConfig } from "../../config/system-config";
import { rescheduleCollectNewsJob } from "../../jobs/collect-news.job";

function friendlyCronText(cron: string, lang: "vi" | "en"): string {
  switch (cron) {
    case "*/5 * * * *":
      return lang === "vi" ? "5 phút" : "5 minutes";
    case "*/15 * * * *":
      return lang === "vi" ? "15 phút" : "15 minutes";
    case "*/30 * * * *":
      return lang === "vi" ? "30 phút" : "30 minutes";
    case "0 * * * *":
      return lang === "vi" ? "1 giờ" : "1 hour";
    case "0 */2 * * *":
      return lang === "vi" ? "2 giờ" : "2 hours";
    case "0 */12 * * *":
      return lang === "vi" ? "12 giờ" : "12 hours";
    default:
      return cron;
  }
}

export function registerSettingsCommand(bot: Bot<Context>, newsCollector: NewsCollector): void {
  // --- 1. Lệnh chính /settings ---
  bot.command("settings", async (ctx) => {
    const chatId = ctx.chat.id;
    let sub = await SubscriberModel.findOne({ chatId });
    if (!sub) {
      sub = await SubscriberModel.create({
        chatId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
      });
    }
    await sendMainSettings(ctx, sub);
  });

  // Alias cho /language
  bot.command(["language", "lang", "ngonngu"], async (ctx) => {
    const chatId = ctx.chat.id;
    let sub = await SubscriberModel.findOne({ chatId });
    if (!sub) {
      sub = await SubscriberModel.create({
        chatId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
      });
    }
    await sendLanguageSubmenu(ctx, sub, false);
  });

  // Alias cho /digest
  bot.command("digest", async (ctx) => {
    const chatId = ctx.chat.id;
    let sub = await SubscriberModel.findOne({ chatId });
    if (!sub) {
      sub = await SubscriberModel.create({
        chatId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
      });
    }
    await sendDigestSubmenu(ctx, sub, false);
  });

  // --- 2. Xử lý Callback Queries ---

  // Quay lại menu chính
  bot.callbackQuery("settings_main", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendMainSettings(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Mở menu con Ngôn ngữ
  bot.callbackQuery("settings_goto_lang", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendLanguageSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Chọn tiếng Việt
  bot.callbackQuery("settings_set_lang_vi", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sub = await SubscriberModel.findOneAndUpdate(
      { chatId },
      { $set: { language: "vi" } },
      { new: true },
    );
    if (sub) {
      await sendLanguageSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery({ text: "Đã đổi sang Tiếng Việt" }).catch(() => {});
  });

  // Chọn tiếng Anh
  bot.callbackQuery("settings_set_lang_en", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sub = await SubscriberModel.findOneAndUpdate(
      { chatId },
      { $set: { language: "en" } },
      { new: true },
    );
    if (sub) {
      await sendLanguageSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery({ text: "Switched to English" }).catch(() => {});
  });

  // Mở menu con Digest
  bot.callbackQuery("settings_goto_digest", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendDigestSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Bật/tắt chế độ Digest
  bot.callbackQuery("settings_digest_toggle", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    let sub = await SubscriberModel.findOne({ chatId });
    if (!sub) return;

    sub.digestMode = !sub.digestMode;
    await sub.save();

    await ctx
      .answerCallbackQuery({
        text: sub.digestMode ? "Đã bật Bản tin tổng hợp!" : "Đã tắt Bản tin tổng hợp!",
      })
      .catch(() => {});

    await sendDigestSubmenu(ctx, sub, true);
  });

  // Thay đổi giờ nhận digest
  bot.callbackQuery(/settings_digest_time_(.+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const newTime = ctx.match[1];
    const sub = await SubscriberModel.findOneAndUpdate(
      { chatId },
      { $set: { digestTime: newTime } },
      { new: true },
    );

    await ctx.answerCallbackQuery({ text: `Đã chọn khung giờ: ${newTime}` }).catch(() => {});
    if (sub) {
      await sendDigestSubmenu(ctx, sub, true);
    }
  });

  // Cài đặt Admin - Trang chính
  bot.callbackQuery("admin_settings_main", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendAdminSettings(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Cài đặt Admin - Mở menu con Feed Source
  bot.callbackQuery("admin_goto_feed_source", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendAdminFeedSourceSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Cài đặt Admin - Mở menu con Cron Interval
  bot.callbackQuery("admin_goto_cron", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      await sendAdminCronSubmenu(ctx, sub, true);
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  // Cài đặt Admin - Thiết lập Feed Source DEV
  bot.callbackQuery("admin_set_feed_dev", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    await updateSystemConfig({ feedSource: "dev" });
    await newsCollector.seedFeeds();

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      const isEn = sub.language === "en";
      await ctx
        .answerCallbackQuery({
          text: isEn ? "Feed source changed to DEV" : "Đã đổi Feed source sang DEV",
        })
        .catch(() => {});
      await sendAdminFeedSourceSubmenu(ctx, sub, true);
    }
  });

  // Cài đặt Admin - Thiết lập Feed Source MXH
  bot.callbackQuery("admin_set_feed_mxh", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    await updateSystemConfig({ feedSource: "mxh" });
    await newsCollector.seedFeeds();

    const sub = await SubscriberModel.findOne({ chatId });
    if (sub) {
      const isEn = sub.language === "en";
      await ctx
        .answerCallbackQuery({
          text: isEn ? "Feed source changed to MXH" : "Đã đổi Feed source sang MXH",
        })
        .catch(() => {});
      await sendAdminFeedSourceSubmenu(ctx, sub, true);
    }
  });

  // Cài đặt Admin - Thiết lập Cron Interval
  bot.callbackQuery(/admin_set_cron_(.+)/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || !env.adminChatIds.includes(chatId)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const cronMap: Record<string, string> = {
      "5m": "*/5 * * * *",
      "15m": "*/15 * * * *",
      "30m": "*/30 * * * *",
      "1h": "0 * * * *",
      "2h": "0 */2 * * *",
      "12h": "0 */12 * * *",
    };

    const key = ctx.match[1];
    const newCron = cronMap[key];
    if (newCron) {
      await updateSystemConfig({ newsCron: newCron });
      rescheduleCollectNewsJob(newCron);

      const sub = await SubscriberModel.findOne({ chatId });
      if (sub) {
        const isEn = sub.language === "en";
        await ctx
          .answerCallbackQuery({
            text: isEn
              ? `Cron interval changed to ${friendlyCronText(newCron, "en")}`
              : `Đã đổi chu kỳ quét sang ${friendlyCronText(newCron, "vi")}`,
          })
          .catch(() => {});
        await sendAdminCronSubmenu(ctx, sub, true);
      }
    } else {
      await ctx.answerCallbackQuery().catch(() => {});
    }
  });
}

// --- 3. Các hàm hiển thị Giao diện ---

async function sendMainSettings(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";

  const categories =
    sub.preferredCategories && sub.preferredCategories.length > 0
      ? sub.preferredCategories.join(", ")
      : isEn
        ? "All"
        : "Tất cả";

  const modeText = sub.digestMode
    ? isEn
      ? `🟢 Digest Mode (${sub.digestTime || "08:00"})`
      : `🟢 Bản tin tổng hợp (${sub.digestTime || "08:00"})`
    : isEn
      ? "⚡ Real-time Alerts"
      : "⚡ Nhận tin tức thì (Real-time)";

  const langText = sub.language === "en" ? "🇺🇸 English" : "🇻🇳 Tiếng Việt";

  const text = isEn
    ? `<b>🛠️ SYSTEM SETTINGS</b>\n` +
      `────────────────\n` +
      `Customize your profile configuration here:\n\n` +
      `• <b>Language:</b> ${langText}\n` +
      `• <b>Notification Mode:</b> ${modeText}\n` +
      `• <b>Interested Topics:</b> <code>${categories}</code>\n\n` +
      `<i>Tip: To change your topics, use command: /category [topics]</i>`
    : `<b>🛠️ CÀI ĐẶT HỆ THỐNG</b>\n` +
      `────────────────\n` +
      `Cấu hình tài khoản nhận tin của bạn tại đây:\n\n` +
      `• <b>Ngôn ngữ:</b> ${langText}\n` +
      `• <b>Chế độ nhận tin:</b> ${modeText}\n` +
      `• <b>Chủ đề quan tâm:</b> <code>${categories}</code>\n\n` +
      `<i>Mẹo: Để thay đổi chủ đề quan tâm, gõ lệnh: /category [tên chủ đề]</i>`;

  const keyboard = new InlineKeyboard()
    .text(isEn ? "🌐 Change Language" : "🌐 Thay đổi Ngôn ngữ", "settings_goto_lang")
    .text(isEn ? "📬 Digest Settings" : "📬 Bản tin tổng hợp", "settings_goto_digest");

  const chatId = ctx.chat?.id;
  if (chatId && env.adminChatIds.includes(chatId)) {
    keyboard.row().text(isEn ? "⚙️ Admin Settings" : "⚙️ Cài đặt Admin", "admin_settings_main");
  }

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function sendLanguageSubmenu(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";

  const text = isEn
    ? `<b>🌐 LANGUAGE SETTINGS</b>\n` +
      `────────────────\n` +
      `Choose your preferred language for news summaries and bot prompts:`
    : `<b>🌐 CÀI ĐẶT NGÔN NGỮ</b>\n` +
      `────────────────\n` +
      `Chọn ngôn ngữ hiển thị tóm tắt tin tức và giao diện của bot:`;

  const keyboard = new InlineKeyboard()
    .text(lang === "vi" ? "✅ 🇻🇳 Tiếng Việt" : "🇻🇳 Tiếng Việt", "settings_set_lang_vi")
    .text(lang === "en" ? "✅ 🇺🇸 English" : "🇺🇸 English", "settings_set_lang_en")
    .row()
    .text(isEn ? "🔙 Back" : "🔙 Quay lại", "settings_main");

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function sendDigestSubmenu(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";
  const digestMode = sub.digestMode || false;
  const digestTime = sub.digestTime || "08:00";

  const text = isEn
    ? `<b>📬 DAILY NEWS DIGEST SETTINGS</b>\n` +
      `────────────────\n` +
      `• <b>Status:</b> ${digestMode ? "🟢 Enabled (Once a day)" : "🔴 Disabled (Real-time notifications)"}\n` +
      `• <b>Time:</b> ${digestMode ? digestTime : "N/A (Real-time)"}\n\n` +
      `<i>In digest mode, bot will group all top stories and send one daily summary message.</i>`
    : `<b>📬 CẤU HÌNG BẢN TIN TỔNG HỢP (DIGEST)</b>\n` +
      `────────────────\n` +
      `• <b>Trạng thái:</b> ${digestMode ? "🟢 Đang bật (1 lần/ngày)" : "🔴 Đang tắt (Nhận tin tức thì)"}\n` +
      `• <b>Giờ gửi tin:</b> ${digestMode ? digestTime : "Không áp dụng (Nhận tin tức thì)"}\n\n` +
      `<i>Khi bật digest, bot sẽ tổng hợp top tin tức và gửi 1 lần duy nhất vào khung giờ bạn chọn.</i>`;

  const keyboard = new InlineKeyboard();

  // Button toggle
  if (isEn) {
    keyboard.text(
      digestMode ? "🔴 Switch to Real-time" : "🟢 Switch to Daily Digest",
      "settings_digest_toggle",
    );
  } else {
    keyboard.text(
      digestMode ? "🔴 Chuyển sang Real-time" : "🟢 Chuyển sang Bản tin tổng hợp",
      "settings_digest_toggle",
    );
  }

  keyboard.row();

  // Khung giờ
  const times = ["08:00", "12:00", "16:00", "20:00"];
  for (const time of times) {
    const label = digestTime === time ? `✅ ${time}` : time;
    keyboard.text(label, `settings_digest_time_${time}`);
  }

  keyboard.row();
  keyboard.text(isEn ? "🔙 Back" : "🔙 Quay lại", "settings_main");

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function sendAdminSettings(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";
  const config = getSystemConfig();

  const text = isEn
    ? `<b>⚙️ ADMIN SYSTEM SETTINGS</b>\n` +
      `────────────────\n` +
      `Configure critical parameters of the bot runtime here:\n\n` +
      `• <b>Feed Source:</b> <code>${config.feedSource}</code>\n` +
      `• <b>Cron Interval:</b> <code>${friendlyCronText(config.newsCron, "en")}</code>\n\n` +
      `Choose from the options below to configure:`
    : `<b>⚙️ CẤU HÌNG HỆ THỐNG - ADMIN</b>\n` +
      `────────────────\n` +
      `Cấu hình các tham số vận hành quan trọng của bot tại đây:\n\n` +
      `• <b>Nguồn tin (Feed Source):</b> <code>${config.feedSource}</code>\n` +
      `• <b>Chu kỳ quét (Cron Interval):</b> <code>${friendlyCronText(config.newsCron, "vi")}</code>\n\n` +
      `Chọn các mục bên dưới để cấu hình:`;

  const keyboard = new InlineKeyboard()
    .text(isEn ? "📁 Feed Source" : "📁 Nguồn tin (Feed)", "admin_goto_feed_source")
    .text(isEn ? "⏱️ Cron Interval" : "⏱️ Chu kỳ quét (Cron)", "admin_goto_cron")
    .row()
    .text(isEn ? "🔙 Back" : "🔙 Quay lại", "settings_main");

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function sendAdminFeedSourceSubmenu(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";
  const config = getSystemConfig();

  const text = isEn
    ? `<b>📁 ADMIN FEED SOURCE SETTINGS</b>\n` +
      `────────────────\n` +
      `Select the feed source to harvest articles from. Default is dev.\n\n` +
      `• <b>Current Source:</b> <code>${config.feedSource}</code>`
    : `<b>📁 CẤU HÌNG NGUỒN TIN (FEED SOURCE)</b>\n` +
      `────────────────\n` +
      `Chọn nguồn tin để thu thập bài viết. Mặc định là dev.\n\n` +
      `• <b>Nguồn hiện tại:</b> <code>${config.feedSource}</code>`;

  const keyboard = new InlineKeyboard()
    .text(config.feedSource === "dev" ? "✅ DEV" : "DEV", "admin_set_feed_dev")
    .text(config.feedSource === "mxh" ? "✅ MXH" : "MXH", "admin_set_feed_mxh")
    .row()
    .text(isEn ? "🔙 Back" : "🔙 Quay lại", "admin_settings_main");

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function sendAdminCronSubmenu(ctx: Context, sub: any, isEdit = false): Promise<void> {
  const lang = sub.language || "vi";
  const isEn = lang === "en";
  const config = getSystemConfig();

  const text = isEn
    ? `<b>⏱️ ADMIN CRON INTERVAL SETTINGS</b>\n` +
      `────────────────\n` +
      `Configure how often the crawler runs:\n\n` +
      `• <b>Current Interval:</b> <code>${friendlyCronText(config.newsCron, "en")}</code>`
    : `<b>⏱️ CẤU HÌNG CHU KỲ QUÉT (CRON)</b>\n` +
      `────────────────\n` +
      `Cấu hình tần suất chạy của tiến trình quét tin tự động:\n\n` +
      `• <b>Chu kỳ hiện tại:</b> <code>${friendlyCronText(config.newsCron, "vi")}</code>`;

  const keyboard = new InlineKeyboard();

  const options = [
    { label: "5m", cron: "*/5 * * * *" },
    { label: "15m", cron: "*/15 * * * *" },
    { label: "30m", cron: "*/30 * * * *" },
    { label: "1h", cron: "0 * * * *" },
    { label: "2h", cron: "0 */2 * * *" },
    { label: "12h", cron: "0 */12 * * *" },
  ];

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const isCurrent = config.newsCron === opt.cron;
    const label = isCurrent ? `✅ ${opt.label}` : opt.label;
    keyboard.text(label, `admin_set_cron_${opt.label}`);
    if (i % 2 === 1) {
      keyboard.row();
    }
  }

  keyboard.row().text(isEn ? "🔙 Back" : "🔙 Quay lại", "admin_settings_main");

  if (isEdit) {
    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(() => {});
  } else {
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}
