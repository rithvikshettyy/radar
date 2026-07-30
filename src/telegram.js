const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

function esc(s) {
  return (s || "").replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function fmt(ev, reminder) {
  const dl = ev.deadline ? `\n⏳ ${new Date(ev.deadline).toDateString()}` : "";
  const tag = reminder ? "⏰ DEADLINE SOON" : "🆕 NEW";
  const loc = ev.location ? ` · ${esc(ev.location)}` : "";
  return `${tag} [${ev.source}]${loc}\n<b>${esc(ev.title)}</b>${dl}\n${esc(ev.url)}`;
}

// Print what would be sent, without touching the network.
export function preview(ev, reminder = false) {
  console.log("[dry] would send:\n" + fmt(ev, reminder) + "\n");
  return true;
}

export async function push(ev, reminder = false) {
  if (!TOKEN || !CHAT) {
    console.log("[dry] would send:\n" + fmt(ev, reminder) + "\n");
    return true;
  }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text: fmt(ev, reminder),
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!r.ok) console.error("telegram fail:", r.status, await r.text());
  return r.ok;
}
