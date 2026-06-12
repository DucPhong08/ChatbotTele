import { type Bot, type Context, InlineKeyboard } from "grammy";
import { SubscriberModel } from "../subscriber.model";

export function registerSettingsCommand(bot: Bot<Context>): void {
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
    : `<b>📬 CẤU HÌNH BẢN TIN TỔNG HỢP (DIGEST)</b>\n` +
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
