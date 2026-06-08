import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";

const README_PATH = "README.md";

// ─── LeetCode ────────────────────────────────────────────────────────────────
async function getLeetCodeStats(username) {
  const query = `
    query userProfile($username: String!) {
      matchedUser(username: $username) {
        submitStats: submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
        profile {
          ranking
        }
      }
    }
  `;
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { username } }),
  });
  const data = await res.json();
  const user = data?.data?.matchedUser;
  if (!user) return null;

  const all = user.submitStats.acSubmissionNum;
  const total = all.find((d) => d.difficulty === "All")?.count ?? 0;
  const easy = all.find((d) => d.difficulty === "Easy")?.count ?? 0;
  const medium = all.find((d) => d.difficulty === "Medium")?.count ?? 0;
  const hard = all.find((d) => d.difficulty === "Hard")?.count ?? 0;
  const ranking = user.profile.ranking ?? "N/A";

  return { total, easy, medium, hard, ranking };
}

// ─── TryHackMe ───────────────────────────────────────────────────────────────
async function getTHMStats(username) {
  const res = await fetch(
    `https://tryhackme.com/api/user/rank/${username}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    rank: data?.userRank ?? "N/A",
    points: data?.points ?? "N/A",
  };
}

// ─── GeeksforGeeks ───────────────────────────────────────────────────────────
async function getGFGStats(username) {
  // Community stats API
  const res = await fetch(
    `https://geeks-for-geeks-stats-api.vercel.app/?raw=Y&userName=${username}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status === "error") return null;
  return {
    solved: data?.totalProblemsSolved ?? data?.info?.totalProblemsSolved ?? "N/A",
    score: data?.codingScore ?? data?.info?.codingScore ?? "N/A",
    rank: data?.instituteRank ?? data?.info?.instituteRank ?? "N/A",
    streak: data?.currentStreak ?? "N/A",
  };
}

// ─── PortSwigger Hall of Fame ─────────────────────────────────────────────────
async function getPortSwiggerRank(username) {
  // Scrape the hall of fame page to find the user's rank
  const res = await fetch("https://portswigger.net/web-security/hall-of-fame");
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  let rank = null;
  // Each entry has a rank number and a name
  $(".hof-entry, .leaderboard-entry, tr").each((i, el) => {
    const text = $(el).text();
    if (text.toLowerCase().includes(username.toLowerCase())) {
      // Try to extract the rank number from the element or its siblings
      const rankEl = $(el).find(".rank, .position, td").first();
      const num = parseInt(rankEl.text().trim(), 10);
      if (!isNaN(num)) rank = num;
    }
  });

  // Fallback: search all text nodes for the username
  if (!rank) {
    const bodyText = $("body").text();
    const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(username.toLowerCase())) {
        // Check previous line for a number (the rank)
        const prev = parseInt(lines[i - 1], 10);
        if (!isNaN(prev)) { rank = prev; break; }
        // Check next line
        const next = parseInt(lines[i + 1], 10);
        if (!isNaN(next)) { rank = next; break; }
      }
    }
  }

  return rank ? { rank } : null;
}

// ─── Inject into README ───────────────────────────────────────────────────────
function inject(readme, tag, value) {
  // Replaces content between <!--START_TAG--> and <!--END_TAG-->
  const re = new RegExp(
    `(<!--START_${tag}-->)[\\s\\S]*?(<!--END_${tag}-->)`,
    "g"
  );
  return readme.replace(re, `$1${value}$2`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const LC_USER  = process.env.LEETCODE_USERNAME || "Pavan_Shanxm49";
  const GFG_USER = process.env.GFG_USERNAME      || "pavanshanmrech";
  const THM_USER = process.env.THM_USERNAME      || "Shanxm";
  const PS_USER  = "Pavan Shanmukha"; // partial name on PortSwigger

  const [lc, thm, gfg, ps] = await Promise.all([
    getLeetCodeStats(LC_USER),
    getTHMStats(THM_USER),
    getGFGStats(GFG_USER),
    getPortSwiggerRank(PS_USER),
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
