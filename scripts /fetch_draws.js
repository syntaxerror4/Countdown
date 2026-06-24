const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const DRAW_JSON_PATH = path.join(__dirname, "..", "Draw.json");
const SOURCE_URL =
  "https://www.canadavisa.com/express-entry-invitations-to-apply-issued.html";

// How many recent draws to keep in the file (set to 0 to keep all)
const MAX_DRAWS = 20;

// Normalize draw type string to something clean
function normalizeType(raw) {
  if (/french/i.test(raw)) return "French Language Proficiency";
  if (/provincial nominee/i.test(raw)) return "Provincial Nominee Program";
  if (/canadian experience/i.test(raw)) return "Canadian Experience Class";
  if (/federal skilled worker/i.test(raw)) return "Federal Skilled Worker";
  if (/federal skilled trades/i.test(raw)) return "Federal Skilled Trades";
  if (/healthcare|social service/i.test(raw))
    return "Healthcare and Social Services";
  if (/trade occupation/i.test(raw)) return "Trades Occupations";
  if (/stem/i.test(raw)) return "STEM Occupations";
  if (/agriculture/i.test(raw)) return "Agriculture and Agri-Food";
  if (/education/i.test(raw)) return "Education Occupations";
  if (/physician/i.test(raw)) return "Physicians with Canadian Experience";
  if (/senior manager/i.test(raw)) return "Senior Managers";
  if (/transport/i.test(raw)) return "Transport Occupations";
  return raw.trim();
}

// Parse "June 23, 2026" -> Date object
function parseDate(str) {
  return new Date(str.trim());
}

async function main() {
  console.log("Fetching draws from canadavisa.com...");

  let html;
  try {
    const res = await axios.get(SOURCE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; DrawBot/1.0; +https://github.com/syntaxerror4/Countdown)",
      },
      timeout: 15000,
    });
    html = res.data;
  } catch (err) {
    console.error("Failed to fetch source:", err.message);
    process.exit(1);
  }

  const $ = cheerio.load(html);
  const scraped = [];

  // Find all draw tables - they have columns: Draw #, Min CRS, Date, # ITAs
  $("table").each((_, table) => {
    const headers = [];
    $(table)
      .find("thead th, tr:first-child th, tr:first-child td")
      .each((_, th) => {
        headers.push($(th).text().toLowerCase());
      });

    // Check this looks like a draws table
    const isDrawTable =
      headers.some((h) => h.includes("draw")) &&
      headers.some((h) => h.includes("crs") || h.includes("score"));

    if (!isDrawTable) return;

    $(table)
      .find("tr")
      .each((rowIdx, row) => {
        if (rowIdx === 0) return; // skip header
        const cells = [];
        $(row)
          .find("td")
          .each((_, td) => cells.push($(td).text().trim()));
        if (cells.length < 4) return;

        // Columns: Draw#, Min CRS (with type in parens), Date, # ITAs
        const drawNumRaw = cells[0].replace(/[^0-9]/g, "");
        const crsAndType = cells[1]; // e.g. "516 (*Canadian Experience Class only)"
        const dateStr = cells[2];
        const itasRaw = cells[3].replace(/[^0-9]/g, "");

        if (!drawNumRaw || !dateStr || !itasRaw) return;

        const drawNumber = parseInt(drawNumRaw, 10);
        const itas = parseInt(itasRaw, 10);

        // Extract CRS score and type from combined cell
        const crsMatch = crsAndType.match(/(\d+)/);
        const typeMatch = crsAndType.match(/\*([^)]+)\)/);
        const score = crsMatch ? parseInt(crsMatch[1], 10) : 0;
        const typeRaw = typeMatch ? typeMatch[1] : "General";
        const type = normalizeType(typeRaw);

        // Parse date
        let date;
        try {
          date = parseDate(dateStr);
          if (isNaN(date.getTime())) return;
        } catch {
          return;
        }

        scraped.push({
          drawNumber,
          date: dateStr,
          type,
          count: itas,
          score,
          _dateObj: date,
        });
      });
  });

  if (scraped.length === 0) {
    console.error("No draws scraped — check if site structure changed.");
    process.exit(1);
  }

  console.log(`Scraped ${scraped.length} draws from source.`);

  // Load existing Draw.json
  let existing = [];
  if (fs.existsSync(DRAW_JSON_PATH)) {
    existing = JSON.parse(fs.readFileSync(DRAW_JSON_PATH, "utf8"));
  }

  const existingDrawNumbers = new Set(existing.map((d) => d.drawNumber));

  // Only keep draws from last 2 months + new ones
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const newDraws = scraped
    .filter((d) => !existingDrawNumbers.has(d.drawNumber))
    .filter((d) => d._dateObj >= twoMonthsAgo);

  if (newDraws.length === 0) {
    console.log("No new draws to add. Draw.json is up to date.");
    return;
  }

  console.log(`Adding ${newDraws.length} new draw(s).`);

  // Clean up temp fields and merge
  const cleaned = newDraws.map(({ _dateObj, ...rest }) => rest);
  const merged = [...cleaned, ...existing];

  // Sort by drawNumber descending
  merged.sort((a, b) => b.drawNumber - a.drawNumber);

  // Optionally trim to MAX_DRAWS
  const final = MAX_DRAWS > 0 ? merged.slice(0, MAX_DRAWS) : merged;

  fs.writeFileSync(DRAW_JSON_PATH, JSON.stringify(final, null, 2));
  console.log(
    `Draw.json updated. Total draws: ${final.length}. Latest: #${final[0].drawNumber}`
  );
}

main();
