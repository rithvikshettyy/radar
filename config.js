// Edit this file to tune what you get.

export const config = {
  // An event is RELEVANT if it matches at least one include keyword
  // AND does not match any exclude keyword. Case-insensitive.
  include: [
    "ai", "ml", "machine learning", "llm", "gen ai", "generative",
    "agent", "hackathon", "buildathon", "devpost", "sarvam",
    "openai", "anthropic", "claude", "gemini", "llama", "rag",
  ],
  // Keep noise out.
  exclude: [
    "high school", "class 9", "class 10", "class 11", "class 12", "school students",
  ],
  // Only surface events that are India-based OR online/remote.
  // Set to false to get everything that matches keywords.
  indiaOrRemoteOnly: true,
  indiaOrRemoteHints: [
    "india", "bengaluru", "bangalore", "mumbai", "delhi", "hyderabad",
    "pune", "chennai", "thane", "goa", "panaji", "kolkata", "ahmedabad",
    "jaipur", "kochi", "chandigarh", "noida", "gurugram", "gurgaon",
    "online", "remote", "virtual", "global",
  ],

  // Luma calendars to watch. Open any Luma calendar page, grab its ICS URL
  // (calendar page -> Subscribe -> "Add to Calendar" gives an ICS link like
  //  https://api.lu.ma/ics/get?entity=cal-XXXX ). Paste those here.
  lumaIcsUrls: [
    // "https://api.lu.ma/ics/get?entity=cal-xxxxxxxx",
  ],

  // Luma DISCOVERY sweep — catches one-off Luma events NOT in any calendar you
  // subscribed to (hacker houses, makeathons, demo days, Sarvam Epoch satellites).
  // Sweeps each category around each city's coordinates. India cities + Goa below.
  lumaDiscover: {
    categories: ["ai", "tech"],
    cities: [
      { name: "Bengaluru", lat: 12.9716, lng: 77.5946 },
      { name: "Mumbai", lat: 19.076, lng: 72.8777 },
      { name: "Delhi", lat: 28.6139, lng: 77.209 },
      { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
      { name: "Pune", lat: 18.5204, lng: 73.8567 },
      { name: "Goa", lat: 15.4909, lng: 73.8278 },
    ],
  },

  // Devfolio (India's main hackathon host). Its list is served from Algolia.
  // Fill these once — all three come from a single request:
  //   devfolio.co/hackathons/open -> DevTools -> Network -> filter "algolia"
  //   -> pick any request -> Headers: copy x-algolia-application-id + x-algolia-api-key
  //   -> the index name is in the request URL: /1/indexes/<indexName>/queries
  // Defaults below are the long-standing public values; if Devfolio rotates the
  // key you'll get a 403 in logs — just recopy apiKey. Leave apiKey blank to skip.
  devfolio: {
    appId: "OFCNCOG2CU",
    apiKey: "", // <-- paste the x-algolia-api-key here
    indexName: "prod_Hackathons",
  },

  // OPTIONAL web-search net for events that live on no structured feed at all.
  // Only runs if BRAVE_API_KEY env is set (Brave Search API free tier).
  searchQueries: [
    "AI hackathon India 2026 apply",
    "hacker house India 2026",
    "Sarvam Epoch 2026",
    "AI buildathon Bengaluru 2026 register",
    "Anthropic Claude hackathon India 2026",
  ],

  // Re-alert this many hours before a deadline/start you've already seen once.
  deadlineReminderHours: 48,
};
