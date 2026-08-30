import { config } from "../config.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// TELEGRAM_CHAT_ID takes one or MORE targets, comma/space separated, so the same
// run can feed your DM and a group your friends are in. Forms accepted:
//   123456789            a person (positive id)
//   -1001234567890       a group/supergroup (always negative, always -100…)
//   @somechannel         a public channel by username
//   -1001234567890:42    a specific topic inside a forum-enabled group
// Split on the LAST colon only — a supergroup id starts with a minus, not a colon,
// but "@name" and plain ids have no colon at all.
export function parseTargets(raw) {
  return String(raw || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.lastIndexOf(":");
      if (i > 0 && /^\d+$/.test(s.slice(i + 1))) {
        return { chatId: s.slice(0, i), topicId: Number(s.slice(i + 1)) };
      }
      return { chatId: s, topicId: null };
    });
}

const TARGETS = parseTargets(process.env.TELEGRAM_CHAT_ID);

// GitHub Actions runners are UTC, so without an explicit zone a 9pm IST event
// renders as the previous day. Bad zone in config -> fall back to UTC, don't throw.
const TZ = (() => {
  const want = config.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: want });
    return want;
  } catch {
    console.error(`bad config.timezone "${want}" — using UTC`);
    return "UTC";
  }
})();

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TZ,
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
});
// YYYY-MM-DD in TZ, so "today"/"yesterday" compare calendar days rather than 24h blocks.
const KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ,
});

function esc(s) {
  return (s || "").replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

// Quotes must die too, or a url containing one breaks out of the href attribute.
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

const dayIndex = (ms) => Math.round(Date.parse(`${KEY_FMT.format(ms)}T00:00:00Z`) / 8.64e7);

// "in 5 hours" / "in 3 days". Empty when the instant is past or unknown.
function untilText(ms, now = Date.now()) {
  const h = (ms - now) / 3.6e6;
  if (!(h > 0)) return "";
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `in ${Math.round(h)}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

// "today" / "yesterday" / "5 days ago". Empty for future or unknown.
function agoText(ms, now = Date.now()) {
  const d = dayIndex(now) - dayIndex(ms);
  if (d < 0) return "";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

// Never render "Invalid Date": if a source hands us something unparseable, show the
// raw value — it's usually still human-readable — rather than leaking JS internals.
function fmtDate(v, withTime = false) {
  if (!v) return "";
  const t = Date.parse(v);
  if (Number.isNaN(t)) return String(v);
  return withTime ? `${DAY_FMT.format(t)}, ${TIME_FMT.format(t)}` : DAY_FMT.format(t);
}

function host(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Colour tag for a source. Telegram bots can't colour text (see config.sourceColors),
// so the colour is an emoji square. Missing/blank entry -> no square, not "undefined".
function dotFor(source) {
  const map = config.sourceColors || {};
  const dot = map[source] ?? map.default ?? "";
  return dot ? `${dot} ` : "";
}

function fmt(ev, reminder = false) {
  const dl = ev.deadline ? Date.parse(ev.deadline) : NaN;
  const left = Number.isNaN(dl) ? "" : untilText(dl);

  const lines = [];

  // Header: which source (by colour), what this alert is, and how urgent.
  const dot = dotFor(ev.source);
  lines.push(
    reminder
      ? `${dot}⏰ <b>DEADLINE SOON</b>${left ? ` — ${left}` : ""}`
      : `${dot}🆕 <b>NEW EVENT</b>`
  );
  lines.push("");

  // Title carries the link, so the raw url doesn't have to. Telegram still builds
  // its link preview from the first href in the message.
  const title = esc(ev.title) || "(untitled)";
  lines.push(ev.url ? `<b><a href="${escAttr(ev.url)}">${title}</a></b>` : `<b>${title}</b>`);
  lines.push("");

  if (ev.location) lines.push(`📍 ${esc(ev.location)}`);

  const when = fmtDate(ev.deadline, true);
  if (when) {
    // On a reminder the countdown is already in the header — don't say it twice.
    const tail = !reminder && left ? ` · ${left}` : "";
    lines.push(`⏳ <b>${esc(when)}</b>${tail}`);
  }

  // Posted = source publish date where a feed exposes one, else the day this radar
  // first saw it (see firstSeen in radar.js). Unknown for pre-existing seen entries.
  const posted = fmtDate(ev.posted);
  if (posted) {
    const ago = Number.isNaN(Date.parse(ev.posted)) ? "" : agoText(Date.parse(ev.posted));
    lines.push(`🗓 Posted ${esc(posted)}${ago ? ` (${ago})` : ""}`);
  }

  const h = host(ev.url);
  lines.push(`🔗 ${esc(ev.source)}${h ? ` · ${h}` : ""}`);

  return lines.join("\n");
}

// Print what would be sent, without touching the network.
export function preview(ev, reminder = false) {
  console.log("[dry] would send:\n" + fmt(ev, reminder) + "\n");
  return true;
}

async function sendTo(target, text) {
  const body = {
    chat_id: target.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  };
  // Forum groups reject a plain send into the General topic on some setups; naming
  // the topic keeps the feed in its own tab instead of the main chat.
  if (target.topicId != null) body.message_thread_id = target.topicId;

  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error(`telegram fail [${target.chatId}]:`, r.status, await r.text());
  return r.ok;
}

export async function push(ev, reminder = false) {
  const text = fmt(ev, reminder);
  if (!TOKEN || !TARGETS.length) {
    console.log("[dry] would send:\n" + text + "\n");
    return true;
  }
  // Sequential, not Promise.all: Telegram caps a bot at ~30 messages/second overall
  // and 20/minute into one group, and a burst gets 429s that drop alerts silently.
  let anyOk = false;
  for (const t of TARGETS) {
    if (await sendTo(t, text)) anyOk = true;
  }
  // One dead target (kicked from a group) must not look like a total failure —
  // the run counts a send as done if it landed anywhere.
  return anyOk;
}

// Exported for selftest — the formatting is what silently breaks (Invalid Date,
// unescaped html, missing fields).
export { fmt as formatMessage };
