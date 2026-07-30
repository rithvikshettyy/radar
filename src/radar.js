import { readFile, writeFile } from "node:fs/promises";
import { fetchDevpost } from "./sources/devpost.js";
import { fetchDevfolio } from "./sources/devfolio.js";
import { fetchLuma } from "./sources/luma.js";
import { fetchLumaDiscover } from "./sources/luma-discover.js";
import { fetchMLH } from "./sources/mlh.js";
import { fetchHackerEarth } from "./sources/hackerearth.js";
import { fetchSarvam } from "./sources/sarvam.js";
import { fetchWebSearch } from "./sources/websearch.js";
import { idFor, isRelevant, deadlineDueSoon } from "./filter.js";
import { push, preview } from "./telegram.js";

const SEEN_PATH = new URL("../data/seen.json", import.meta.url);
const DRY = process.argv.includes("--dry");
// Record everything as already-seen without notifying. Run this once after
// switching on a new source (devfolio key, a new Luma calendar) so its whole
// existing backlog doesn't land as one flood — you then only get what's posted after.
const SEED = process.argv.includes("--seed");

async function loadSeen() {
  try {
    return JSON.parse(await readFile(SEEN_PATH, "utf8"));
  } catch {
    return {}; // { id: { remindedForDeadline: bool } }
  }
}

async function main() {
  const seen = await loadSeen();

  const results = await Promise.allSettled([
    fetchDevpost(),
    fetchDevfolio(),
    fetchLuma(),
    fetchLumaDiscover(),
    fetchMLH(),
    fetchHackerEarth(),
    fetchSarvam(),
    fetchWebSearch(),
  ]);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  const events = all.map((e) => ({ ...e, id: idFor(e) })).filter(isRelevant);

  let newCount = 0;
  let remindCount = 0;
  let sentCount = 0;

  // SEED records state only; DRY prints instead of sending. Both leave Telegram alone.
  const deliver = async (ev, reminder) => {
    if (SEED) return;
    if (DRY) return void preview(ev, reminder);
    if (await push(ev, reminder)) sentCount++;
  };

  for (const ev of events) {
    const rec = seen[ev.id];
    if (!rec) {
      await deliver(ev, false);
      seen[ev.id] = { remindedForDeadline: false };
      newCount++;
    } else if (!rec.remindedForDeadline && deadlineDueSoon(ev)) {
      await deliver(ev, true);
      rec.remindedForDeadline = true;
      remindCount++;
    }
  }

  await writeFile(SEEN_PATH, JSON.stringify(seen, null, 2));
  console.log(
    `scanned=${all.length} relevant=${events.length} new=${newCount} ` +
      `reminders=${remindCount} sent=${sentCount} dry=${DRY} seed=${SEED}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
