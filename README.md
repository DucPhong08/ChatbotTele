# ChatbotTele

## Cấu hình chính

- `BOT_TOKEN`: Telegram bot token.
- `MONGO_URI`: MongoDB connection string.
- `ADMIN_CHAT_IDS`: danh sách Telegram chat id được phép chạy `/sync`, phân tách bằng dấu phẩy. Ví dụ: `123456789,-1001234567890`.
- `AI_PROVIDER`: `gemini`, `openai` hoặc `groq`. Mặc định là `gemini`.

Nếu không cấu hình `ADMIN_CHAT_IDS`, lệnh `/sync` sẽ bị khóa.
