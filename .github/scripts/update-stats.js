import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";

const README_PATH = "README.md";
const TIMEOUT_MS = 10000; // 10 second timeout per request

// ─── Fetch with timeout ───────────────────────────────────────────────────────
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ─── LeetCode (GraphQL API — works fine) ─────────────────────────────────────
async function getLeetCodeStats(username) {
  try {
    const query = `
      query userProfile($username: String!) {
        matchedUser(username: $username) {
          submitStats: submitStatsGlobal {
            acSubmissionNum { difficulty count }
          }
          profile { ranking }
        }
      }
    `;
    const res = await fetchWithTimeout("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { username } }),
    });
    const data = await res.json();
    const user = data?.data?.matchedUser;
    if (!user) return null;
    const all = user.submitStats.acSubmissionNum;
    return {
      total:   all.find((d) => d.difficulty === "All")?.count    ?? 0,
      easy:    all.find((d) => d.difficulty === "Easy")?.count   ?? 0,
      medium:  all.find((d) => d.difficulty === "Medium")?.count ?? 0,
      hard:    all.find((d) => d.difficulty === "Hard")?.count   ?? 0,
      ranking: user.profile.ranking ?? "N/A",
    };
  } catch (e) {
    console.error("LeetCode error:", e.message);
    return null;
  }
}

// ─── TryHackMe (correct v1 API endpoint) ─────────────────────────────────────
async function getTHMStats(username) {
  try {
    // Use the public profile API — returns JSON with rank and points
    const res = await fetchWithTimeout(
      `https://tryhackme.com/api/user/rank/${username}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; GitHub-Actions-Stats-Bot)",
          "Accept": "application/json",
          "Referer": "https://tryhackme.com/",
        },
      }
    );
    if (!res.ok) {
      console.error("THM HTTP error:", res.status);
      return null;
    }
    const data = await res.json();
    console.log("THM raw:", JSON.stringify(data));
    return {
      rank:   data?.userRank   ?? data?.rank   ?? "N/A",
      points: data?.userPoints ?? data?.points ?? "N/A",
    };
  } catch (e) {
    console.error("TryHackMe error:", e.message);
    return null;
  }
}

// ─── GeeksforGeeks (scrape profile page directly) ────────────────────────────
async function getGFGStats(username) {
  try {
    const res = await fetchWithTimeout(
      `https://www.geeksforgeeks.org/user/${username}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
        },
      }
    );
    if (!res.ok) {
      console.error("GFG HTTP error:", res.status);
      return null;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    // GFG embeds stats in a __NEXT_DATA__ JSON blob
    const nextData = $("#__NEXT_DATA__").text();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        // Navigate to user info — path varies by GFG build
        const props =
          json?.props?.pageProps?.userInfo ||
          json?.props?.pageProps?.profileInfo ||
          json?.props?.pageProps;
        if (props) {
          const solved =
            props?.totalProblemsSolved ??
            props?.solvedStats?.total ??
            props?.info?.totalProblemsSolved ?? "N/A";
          const score =
            props?.score ?? props?.codingScore ?? props?.info?.codingScore ?? "N/A";
          const rank =
            props?.instituteRank ?? props?.info?.instituteRank ?? "N/A";
          const streak =
            props?.currentStreak ?? props?.streak?.current ?? "N/A";
          console.log("GFG parsed:", { solved, score, rank, streak });
          return { solved, score, rank, streak };
        }
      } catch (_) {}
    }

    // Fallback: scrape visible text from known selectors
    const solved =
      $('[class*="solved"], [class*="problemSolved"], .score_card_value').first().text().trim() || "N/A";
    console.log("GFG fallback solved:", solved);
    return { solved, score: "N/A", rank: "N/A", streak: "N/A" };
  } catch (e) {
    console.error("GFG error:", e.message);
    return null;
  }
}

// ─── PortSwigger (hardcode rank — HoF only shows top ~50 publicly) ────────────
// Since rank #37190 is not on the public leaderboard page, we store it as a
// known value. Update PS_KNOWN_RANK in the workflow env if it changes.
async function getPortSwiggerRank() {
  const knownRank = process.env.PS_KNOWN_RANK || "37190";
  return { rank: knownRank };
}

// ─── Inject into README ───────────────────────────────────────────────────────
function inject(readme, tag, value) {
  const re = new RegExp(`(<!--START_${tag}-->)[\\s\\S]*?(<!--END_${tag}-->)`, "g");
  return readme.replace(re, `$1${value}$2`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const LC_USER  = process.env.LEETCODE_USERNAME || "Pavan_Shanxm49";
  const GFG_USER = process.env.GFG_USERNAME      || "pavanshanmrech";
  const THM_USER = process.env.THM_USERNAME      || "Shanxm";

  // Run all fetches in parallel with individual error handling
  const [lc, thm, gfg, ps] = await Promise.all([
    getLeetCodeStats(LC_USER),
    getTHMStats(THM_USER),
    getGFGStats(GFG_USER),
    getPortSwiggerRank(),
  ]);

  console.log("LeetCode:", lc);
  console.log("TryHackMe:", thm);
  console.log("GFG:", gfg);
  console.log("PortSwigger:", ps);

  let readme = fs.readFileSync(README_PATH, "utf8");

  if (lc) {
    readme = inject(readme, "LC_TOTAL",  `${lc.total}`);
    readme = inject(readme, "LC_EASY",   `${lc.easy}`);
    readme = inject(readme, "LC_MEDIUM", `${lc.medium}`);
    readme = inject(readme, "LC_HARD",   `${lc.hard}`);
    readme = inject(readme, "LC_RANK",   `${lc.ranking}`);
  }
  if (thm) {
    readme = inject(readme, "THM_RANK",   `${thm.rank}`);
    readme = inject(readme, "THM_POINTS", `${thm.points}`);
  }
  if (gfg) {
    readme = inject(readme, "GFG_SOLVED",  `${gfg.solved}`);
    readme = inject(readme, "GFG_SCORE",   `${gfg.score}`);
    readme = inject(readme, "GFG_RANK",    `${gfg.rank}`);
    readme = inject(readme, "GFG_STREAK",  `${gfg.streak}`);
  }
  if (ps) {
    readme = inject(readme, "PS_RANK", `#${ps.rank}`);
  }

  readme = inject(readme, "LAST_UPDATED", new Date().toUTCString());

  fs.writeFileSync(README_PATH, readme, "utf8");
  console.log("README.md updated ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
