import * as cheerio from "cheerio";
import { normalize } from "../filter.js";

// MLH season page. Scrape is fragile by nature — wrapped, non-fatal.
const YEAR = new Date().getFullYear();
const URL = `https://mlh.io/seasons/${YEAR}/events`;

export async function fetchMLH() {
  const out = [];
  try {
    const r = await fetch(URL, { headers: { "user-agent": "event-radar" } });
    if (!r.ok) return out;
    const $ = cheerio.load(await r.text());
    $(".event").each((_, el) => {
      const name = $(el).find(".event-name").text().trim();
      const href = $(el).find("a.event-link").attr("href") || "";
      const loc =
        $(el).find(".event-location").text().trim() ||
        $(el).find(".event-hybrid-notes").text().trim();
      const date = $(el).find(".event-date").text().trim();
      if (!name) return;
      out.push(
        normalize(
          { title: name, url: href, location: loc, description: date },
          "mlh"
        )
      );
    });
  } catch (e) {
    console.error("mlh fail:", e.message);
  }
  return out;
}
