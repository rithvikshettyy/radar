// Prints every chat your bot can currently see, with the id to paste into
// TELEGRAM_CHAT_ID. Run it after adding the bot to a group:
//
//   TELEGRAM_BOT_TOKEN=xxx npm run chatid
//
// Group ids are NEGATIVE (-1001234567890 for a supergroup) and there is no other
// practical way to read one — @userinfobot only knows your personal id.
//
// Two Telegram behaviours make an empty result normal rather than broken:
//   1. Bots have "group privacy" ON by default, so inside a group they only see
//      messages that are commands or that @mention them. Sending "/start@yourbot"
//      in the group is what makes the chat appear here.
//   2. getUpdates only returns the last ~24h, and it CONSUMES what it returns —
//      a second run right after can legitimately print nothing new.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not set.\n  TELEGRAM_BOT_TOKEN=xxx npm run chatid");
  process.exit(1);
}

const api = async (method, params = {}) => {
  const u = new URL(`https://api.telegram.org/bot${TOKEN}/${method}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) {
    // 401 means a bad/revoked token; anything else is worth printing verbatim.
    throw new Error(`${method} failed: ${r.status} ${body.description || ""}`.trim());
  }
  return body.result;
};

const me = await api("getMe");
console.log(`bot: @${me.username} (${me.first_name})\n`);

// A webhook, if one is set, swallows every update before getUpdates can see it.
const hook = await api("getWebhookInfo").catch(() => null);
if (hook?.url) {
  console.error(`⚠ a webhook is set (${hook.url}) — getUpdates will stay empty until it's removed\n`);
}

const updates = await api("getUpdates", { timeout: 0, limit: 100 });

const chats = new Map();
for (const u of updates) {
  const msg = u.message || u.edited_message || u.channel_post || u.my_chat_member;
  const c = msg?.chat;
  if (c) chats.set(c.id, c);
}

if (!chats.size) {
  console.log("No chats visible yet.\n");
  console.log("  DM   — message the bot anything, then re-run.");
  console.log(`  group — add @${me.username} to the group, send "/start@${me.username}" there, then re-run.`);
  process.exit(0);
}

console.log("chat id            type        name");
console.log("-----------------  ----------  ----");
for (const c of chats.values()) {
  const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "";
  console.log(`${String(c.id).padEnd(17)}  ${String(c.type).padEnd(10)}  ${name}`);
}

console.log("\nPaste into TELEGRAM_CHAT_ID. Several targets = comma separated:");
console.log("  TELEGRAM_CHAT_ID=123456789,-1001234567890");
console.log("A forum topic is <chatId>:<topicId>, e.g. -1001234567890:42");
