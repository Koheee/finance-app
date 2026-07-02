/*
 * Statement engine — faithful JS port of the Python pipeline
 * (pdf_reader.py, bank_reader.py, paylah_reader.py, categories.py,
 *  export_csv.py SPEND_SIGN, cashflow.py).
 *
 * All processing happens on-device. Personal rules (employer, linked
 * accounts, one-off overrides, extra category keywords) are NOT in this
 * file — they are imported privately by the user and merged at runtime.
 */
"use strict";

// ---------------------------------------------------------------------------
// Flow types (bank) — names must match the Python constants / master CSV.
// ---------------------------------------------------------------------------
const FLOW = {
  SALARY: "Salary",
  INTEREST: "Interest",
  MISC_INCOME: "Misc Income",
  REIMBURSEMENT: "Reimbursement",
  CARD_PAYMENT: "Card Payment",
  DEBIT_SPEND: "Debit Card Spend",
  GRABPAY: "Grab (GrabPay)",
  PAYLAH_OUT: "PayLah Top-up",
  PAYLAH_IN: "PayLah Send-back",
  HOUSEHOLD: "Household (shared)",
  TRAVEL_FUND: "Travel Fund (Wise)",
  BET: "Betting (bets)",
  WINNINGS: "Betting winnings",
  BILL: "Bill / GIRO",
  LOAN: "Loan Repayment",
  INVESTMENT: "Investment / Savings",
  PAYNOW_OUT: "PayNow Out",
  TRANSFER: "Bank Transfer",
  FEE: "Fee",
  OTHER_IN: "Other Inflow",
  OTHER_OUT: "Other Outflow",
};

// spend_sgd sign per bank flow (export_csv.py SPEND_SIGN).
const SPEND_SIGN = {
  [FLOW.DEBIT_SPEND]: 1, [FLOW.GRABPAY]: 1, [FLOW.PAYNOW_OUT]: 1,
  [FLOW.HOUSEHOLD]: 1, [FLOW.TRAVEL_FUND]: 1, [FLOW.BET]: 1,
  [FLOW.WINNINGS]: -1, [FLOW.REIMBURSEMENT]: -1,
  [FLOW.PAYLAH_OUT]: 0, [FLOW.PAYLAH_IN]: 0,
  [FLOW.SALARY]: 0, [FLOW.INTEREST]: 0, [FLOW.MISC_INCOME]: 0,
  [FLOW.CARD_PAYMENT]: 0, [FLOW.BILL]: 0, [FLOW.LOAN]: 0,
  [FLOW.FEE]: 0, [FLOW.INVESTMENT]: 0, [FLOW.TRANSFER]: 0,
  [FLOW.OTHER_IN]: 0, [FLOW.OTHER_OUT]: 0,
};

// Monthly cash-flow buckets (cashflow.py).
const CF_INCOME = new Set([FLOW.SALARY, FLOW.INTEREST, FLOW.MISC_INCOME, FLOW.REIMBURSEMENT]);
const CF_SPEND = new Set([FLOW.CARD_PAYMENT, FLOW.HOUSEHOLD, FLOW.DEBIT_SPEND, FLOW.GRABPAY,
  FLOW.PAYNOW_OUT, FLOW.BILL, FLOW.LOAN, FLOW.BET, FLOW.TRAVEL_FUND, FLOW.FEE]);
const CF_INVEST = new Set([FLOW.INVESTMENT]);

// ---------------------------------------------------------------------------
// Categories (categories.py) — order matters; first hit wins.
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  ["Subscriptions", ["netflix", "spotify", "disney+", "disney plus", "hbo", "max ",
    "youtube premium", "apple.com/bill", "apple music", "icloud",
    "prime video", "amazon prime", "audible", "patreon", "nytimes",
    "new york times", "notion", "github", "openai", "chatgpt",
    "adobe", "dropbox", "google storage", "google one", "1password",
    "linkedin", "canva", "grammarly", "viu", "wetv", "iqiyi",
    "bitdefender", "norton", "mcafee", "microsoft 365", "office 365",
    "nihondex"]],
  ["Education", ["ikoma", "language school", "corporatefinanceinst",
    "corporate finance inst", "udemy", "coursera", "skillshare",
    "skillsfuture", "tuition", "academy", "institute"]],
  ["Groceries", ["fairprice", "ntuc", "sheng siong", "cold storage", "giant",
    "scarlett supermarket", "prime supermarket", "mustafa", "redmart",
    "supermarket", "grocery", "wholefoods", "whole foods", "trader joe",
    "costco", "amazon fresh", "kuriya japanese mkt"]],
  ["Dining", ["ya kun", "kaya toast", "toast box", "kopitiam", "astons", "poulet",
    "soupcup", "soup cup", "old chang kee", "loy kee", "nasi lemak",
    "ponggol", "marutama", "ramen", "nori", "malatang", "hawker",
    "bakerycuisine", "bakery", "tous les jours", "pokka", "karekami",
    "burger king", "kfc", "mcdonald", "subway", "jollibee", "din tai fung",
    "crystal jade", "saizeriya", "genki", "sushi", "boost juice", "liho",
    " koi", "gong cha", "chicken rice", "restaurant", "cafe", "coffee",
    "pizza", "thai", "taco", "burger", "deli", "diner", "bar ", "pub",
    "dunkin", "starbucks", "chipotle", "doordash", "grubhub",
    "grb*", "five guys", "fiveguys", "soup spoon", "soupspoon",
    "pepper lunch", "keisuke", "tonkotsu", "breadtalk", "jollibean",
    "haidilao", "guzman", "gyg ", "ps.cafe", "pscafe", "ps cafe",
    "dough culture", "dough magic", "providore", "nam kee", "souperstar",
    "soupstar", "monigiri", "tongsui", "martabak", "salt bread", "noodles",
    "hunan", "dezato", "tofug", "torigo", "pandasnacks", "lee wee",
    "ryokudo", "wu lao lao", "xiang xiang", "steak", "pau ",
    "hiseries", "aifokato", "fieldnotes", "song market", "superstaple",
    "tangled", "charrr", "fu lin", "green chili", "catch table", "ijooz",
    "hot & cold", "eat. @", "atlasvending",
    "malatan", "seaf", "bbq", "nasi lem", "barcook", "nan xiang",
    "le fu ge", "liu kou shu", "eatero", "penang", "ultra bake",
    "island drin", "fried ho", "tau suan", "feng wei", "ji hui lai",
    "rochor", "goodbakes", "new dle", "kim fu li", "bunga raya",
    "sghockpraw", "punggol", "koi the", "jia li", "kimdo", "madam tang",
    "bendemeer", "all fresh", "style palat", "cv fried", "lexus duri",
    "ah liang", "scent disco", "qashier", "fomo pay"]],
  ["Transport", ["bus/mrt", "grab", "gojek", "go-jek", "tada", "comfortdelgro",
    "comfort delgro", "ez-link", "ezlink", "simplygo", "esso", "caltex",
    "spc ", "shell", "smrt", "transit", "parking", "carpark", "ute ",
    "uber", "lyft", "taxi"]],
  ["Utilities & Bills", ["sp group", "sp services", "singtel", "starhub", "m1 limited",
    "m1ltd", "m1 ltd", "m1app", "m1 ", "circles.life", "simba",
    "myrepublic", "city gas", "pub ", "insurance", "great eastern",
    "prudential", "aia ", "ntuc income", "comcast", "xfinity", "verizon",
    "t-mobile", "inland rev", "immigratio", "qb net"]],
  ["Shopping", ["shopee", "lazada", "taobao", "tiktok shop", "qoo10", "harvey norman",
    "courts", "challenger", "popular book", "popular ", "isetan",
    "takashimaya", "bhg", "metro ", "uniqlo", "decathlon", "ikea",
    "best denki", "best buy", "amazon", "amzn", "ebay", "etsy", "carousell",
    "nike", "zara", "h&m", "sephora", "watsons online", "skechers",
    "ultron sports", "sports pte", "yufu", "good service tech", "kim able"]],
  ["Entertainment", ["arcade", "golden village", "cathay cineplex", "shaw theatres",
    "gv ", "cinema", "movie", "ticketmaster", "sistic", "klook", "steam",
    "playstation", "xbox", "nintendo", "concert", "theatre", "theater"]],
  ["Health & Fitness", ["guardian", "watsons", "unity pharmacy", "pharmacy", "polyclinic",
    "clinic", "hospital", "raffles medical", "novena", "dental",
    "fitness first", "anytime fitness", "gymmboxx", "gym", "fitness",
    "vitamin", "tcm", "venus beauty", "beauty", "salon", "nail", "spa "]],
  ["Travel", ["trip.com", "singapore airlines", "scoot", "jetstar", "airasia",
    "agoda", "kkday", "expedia", "booking.com", "airbnb", "changi airport",
    "hotel", "hostel", "airline", "airlines", "marriott", "hilton",
    "rcl ", "ovation", "royal caribbean", "cruise", "wise asia", "wise "]],
];
const UNCATEGORIZED = "Uncategorized";

function categorize(description, rules) {
  const text = (description || "").toLowerCase();
  const extra = (rules && rules.extraCategoryKeywords) || {};
  for (const [cat, kws] of CATEGORY_RULES) {
    const all = kws.concat(extra[cat] || []);
    for (const kw of all) if (text.includes(kw)) return cat;
  }
  for (const cat of Object.keys(extra)) {
    if (CATEGORY_RULES.some(([c]) => c === cat)) continue;
    for (const kw of extra[cat]) if (text.includes(kw)) return cat;
  }
  return UNCATEGORIZED;
}

// ---------------------------------------------------------------------------
// PDF text extraction (pdf.js) → lines, approximating pdfplumber's layout.
// Filters rotated sidebar text; joins items gap-aware so amounts stay intact.
// ---------------------------------------------------------------------------
async function extractLines(pdf) {
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => {
      const t = it.transform;
      return it.str && it.str.trim() && Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01;
    });
    // group by y with tolerance
    const rows = [];
    for (const it of items) {
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.0);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.transform[4] - b.transform[4]);
      let s = "", endX = null;
      for (const it of row.items) {
        const x = it.transform[4];
        if (endX !== null) s += (x - endX) > 1.0 ? " " : "";
        s += it.str;
        endX = x + (it.width || 0);
      }
      lines.push(s);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Statement sniffing
// ---------------------------------------------------------------------------
function sniffStatement(text) {
  if (text.includes("PayLah")) return "paylah";
  if (text.includes("Consolidated Statement") || text.includes("Account Summary")) return "bank";
  if (text.includes("Credit Cards") || text.includes("Statement of Account")) return "card";
  return "unknown";
}

const MONTHS3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const num = (s) => parseFloat(s.replace(/,/g, ""));
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function stmtDateFrom(text) {
  const m = text.match(/STATEMENT DATE[\s\S]*?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (!m) return null;
  const mon = MONTHS3[m[2].slice(0, 3).toLowerCase()];
  return mon ? { y: +m[3], m: mon, d: +m[1] } : null;
}

// ---------------------------------------------------------------------------
// Credit-card parser (pdf_reader.py)
// ---------------------------------------------------------------------------
const CARD_LINE = /^(\d{1,2})\s+([A-Z]{3})\s+(.+?)\s+([\d,]+\.\d{2})(\s+CR)?\s*$/;
const CARD_SKIP = ["PREVIOUS BALANCE", "SUB-TOTAL", "TOTAL", "GRAND TOTAL", "BALANCE"];
const PAYMENT_MARKERS = ["BILL PAYMENT", "PAYMENT - DBS", "PAYMENT-DBS", "GIRO", "PAYMENT THANK"];

function parseCard(lines, text, rules) {
  const sd = stmtDateFrom(text);
  const sy = sd ? sd.y : new Date().getFullYear();
  const sm = sd ? sd.m : 12;
  const rows = [];
  for (const raw of lines) {
    const m = raw.trim().match(CARD_LINE);
    if (!m) continue;
    const [, day, mon3, descRaw, amt, cr] = m;
    const monn = MONTHS3[mon3.toLowerCase()];
    if (!monn) continue;
    const desc = descRaw.trim();
    const U = desc.toUpperCase();
    if (CARD_SKIP.some((p) => U.startsWith(p))) continue;
    const year = monn > sm ? sy - 1 : sy;
    const value = num(amt);
    let signed;
    if (cr) {
      if (PAYMENT_MARKERS.some((mk) => U.includes(mk))) continue;
      signed = -value;
    } else signed = value;
    const date = iso(year, monn, +day);
    rows.push({
      date, month: date.slice(0, 7), source: "card",
      type: categorize(desc, rules), description: desc, counterparty: "",
      direction: signed >= 0 ? "out" : "in",
      amount_sgd: r2(Math.abs(signed)), spend_sgd: r2(signed),
    });
  }
  if (!rows.length) throw new Error("No card transactions found in this PDF.");
  const key = sd ? `card:${iso(sd.y, sd.m, sd.d)}` : "card:unknown";
  return { rows, key, stmtMonth: sd ? iso(sd.y, sd.m, 1).slice(0, 7) : null };
}

// ---------------------------------------------------------------------------
// Bank (Consolidated) parser (bank_reader.py)
// ---------------------------------------------------------------------------
const ENTITY_MARKERS = ["PTE", "LTD", "LIMITED", "PRIVATE", "LLP", "BANK", "GROUP"];
const BANK_DATE = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;
const AMT_RE = /\d[\d,]*\.\d{2}/g;

function looksLikePerson(cp) {
  const name = (cp || "").toUpperCase();
  if (!name) return false;
  return !ENTITY_MARKERS.some((mk) => name.includes(mk));
}
function samePerson(a, b) {
  const tok = (s) => new Set(((s || "").toUpperCase().match(/[A-Z]+/g) || []).filter((w) => w.length > 1));
  const ta = tok(a), tb = tok(b);
  if (!ta.size || ta.size !== tb.size) return false;
  for (const w of ta) if (!tb.has(w)) return false;
  return true;
}

function classifyFlow(desc, detail, counterparty, direction, holder, rules) {
  const u = `${desc} ${detail} ${counterparty}`.toUpperCase();
  const R = rules || {};
  for (const [ref, flow] of Object.entries(R.overrides || {}))
    if (u.includes(ref.toUpperCase())) return flow;

  const du = desc.toUpperCase();
  if (u.includes("GIRO SALARY") || (du.startsWith("GIRO") && u.includes("SALARY"))) return FLOW.SALARY;
  if (direction === "IN" && (R.salaryPayers || []).some((p) => u.includes(p.toUpperCase()))) return FLOW.SALARY;
  if (u.includes("INTEREST EARNED")) return FLOW.INTEREST;
  if (u.includes("SERVICE CHARGE")) return FLOW.FEE;
  if (u.includes("BILL PAYMENT") && u.includes("DBSC-")) return FLOW.CARD_PAYMENT;
  if (u.includes("DEBIT CARD TRANSACTION")) return FLOW.DEBIT_SPEND;
  if (u.includes("GRABPAY TOPUP")) return FLOW.GRABPAY;
  if (u.includes("TOP-UP TO PAYLAH")) return FLOW.PAYLAH_OUT;
  if (u.includes("SEND BACK FROM PAYLAH")) return FLOW.PAYLAH_IN;
  if (u.includes("DCC (LOAN)") || u.includes("LOAN")) return FLOW.LOAN;
  if (du.startsWith("GIRO")) return FLOW.BILL;
  if (["INVESTMENT & SECURITIES", "FUND MGT", "SECURITIES", "CPF", "SRS"].some((k) => u.includes(k)))
    return FLOW.INVESTMENT;

  for (const [tag, spec] of Object.entries(R.externalAccounts || {})) {
    const [flow, wantDir] = spec;
    if (u.includes(`${tag}:`) && direction === wantDir) return flow;
  }
  if (/TW0{6,}\d+/.test(u)) return FLOW.TRAVEL_FUND;
  if (/^SF\d{6,}$/.test((counterparty || "").trim())) return direction === "OUT" ? FLOW.BET : FLOW.WINNINGS;

  if (direction === "IN") {
    for (const [swift, flow] of Object.entries(R.inboundBankSwift || {}))
      if (u.includes(swift)) return flow;
    if (u.includes("INCOMING PAYNOW") || (u.includes("PAYNOW") && u.includes("FROM:"))) {
      if (holder && samePerson(counterparty, holder)) return FLOW.TRANSFER;
      return looksLikePerson(counterparty) ? FLOW.REIMBURSEMENT : FLOW.OTHER_IN;
    }
    return FLOW.OTHER_IN;
  }
  if (u.includes("PAYNOW TRANSFER") && u.includes("TO:")) return FLOW.PAYNOW_OUT;
  if (u.includes("TRANSFER") || u.includes("I-BANK")) return FLOW.TRANSFER;
  return FLOW.OTHER_OUT;
}

function parseBank(lines, text, rules, account = "DBS Multiplier Account") {
  const asof = text.match(/as at (\d{1,2})\s+(\w+)\s+(\d{4})/);
  const asofIso = asof ? iso(+asof[3], MONTHS3[asof[2].slice(0, 3).toLowerCase()] || 12, +asof[1]) : null;

  let holder = "";
  for (const ln of lines.slice(0, 15)) {
    const s = ln.trim();
    if (/^[A-Z]{2,}(?: [A-Z]{2,}){1,3}$/.test(s) && !s.includes("STATEMENT")) { holder = s; break; }
  }

  let inSection = false, balance = null;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (ln.includes(account) && ln.includes("Account No.")) { inSection = true; balance = null; }
    else if (inSection && ln.startsWith("Total Balance Carried Forward")) inSection = false;

    if (inSection && ln.startsWith("Balance Brought Forward")) {
      const nums = ln.match(AMT_RE);
      if (nums) balance = num(nums[nums.length - 1]);
    }
    const m = ln.match(BANK_DATE);
    if (inSection && m && balance !== null) {
      const rest = m[2];
      const nums = rest.match(AMT_RE) || [];
      if (nums.length >= 2) {
        const amount = num(nums[nums.length - 2]);
        const newBal = num(nums[nums.length - 1]);
        const delta = r2(newBal - balance);
        const direction = delta > 0 ? "IN" : "OUT";
        const cut = rest.lastIndexOf(nums[nums.length - 2]);
        const desc = rest.slice(0, cut).trim();

        const cont = [];
        let j = i + 1;
        while (j < lines.length) {
          const nx = lines[j].trim();
          if (!nx || nx.startsWith("PDS_") || nx.startsWith("Transaction Details")) { j++; continue; }
          if (BANK_DATE.test(nx) || nx.startsWith("Balance") || nx.startsWith("Total") || nx.includes("Account No.")) break;
          cont.push(nx); j++;
        }
        let cp = "";
        for (const c of cont) {
          const up = c.toUpperCase();
          if (up.startsWith("FROM:") || up.startsWith("TO:")) { cp = c.slice(c.indexOf(":") + 1).trim(); break; }
        }
        if (!cp) cp = cont.length ? cont[0].trim() : "";
        const flow = classifyFlow(desc, cont.join(" "), cp, direction, holder, rules);
        const [dd, mm, yy] = m[1].split("/");
        const date = `${yy}-${mm}-${dd}`;
        const sign = SPEND_SIGN[flow] ?? 0;
        rows.push({
          date, month: date.slice(0, 7), source: "bank",
          type: flow, description: desc, counterparty: cp,
          direction: direction.toLowerCase(),
          amount_sgd: r2(Math.abs(delta)), spend_sgd: r2(Math.abs(delta) * sign),
        });
        balance = newBal;
      }
    }
  }
  if (!rows.length) throw new Error(`No '${account}' transactions found — is this a DBS Consolidated statement?`);
  return { rows, key: `bank:${asofIso || "unknown"}`, stmtMonth: asofIso ? asofIso.slice(0, 7) : null };
}

// ---------------------------------------------------------------------------
// PayLah parser (paylah_reader.py)
// ---------------------------------------------------------------------------
const PAYLAH_LINE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(.+?)\s+([\d,]+\.\d{2})\s+(CR|DB)$/;
const PAYLAH_SKIP = ["PREVIOUS BALANCE", "NEW TRANSACTIONS", "TOTAL"];
const PL_INTERNAL = "Transfer (internal)";
const PL_PEER = "Peer payment";

function paylahClean(desc) {
  let d = desc.replace(/^PAYNOW\s+/i, "");
  d = d.replace(/\s+[A-Z0-9]{8,}\.?\.?\.?$/, "");
  d = d.replace(/\s+PAYNOW TRANSFER$/i, "");
  return d.trim();
}
function paylahCounterparty(desc) {
  const U = desc.toUpperCase();
  for (const kw of ["RECEIVE MONEY FROM", "SEND MONEY TO", "PAYNOW"])
    if (U.startsWith(kw)) return desc.slice(kw.length).trim();
  return "";
}
function paylahClassify(desc, direction, rules) {
  const u = desc.toUpperCase();
  if (u.includes("TOP UP WALLET") || u.includes("SEND MONEY TO MY ACCOUNT")) return [PL_INTERNAL, 0];
  if (direction === "in") return [FLOW.REIMBURSEMENT, -1];
  if (u.includes("SEND MONEY TO") || u.includes("PAYNOW TO ")) return [PL_PEER, 1];
  const cat = categorize(paylahClean(desc), rules);
  if (cat === UNCATEGORIZED && u.trimEnd().endsWith("PAYNOW TRANSFER")) return [PL_PEER, 1];
  return [cat, 1];
}

function parsePayLah(lines, text, rules) {
  const sd = stmtDateFrom(text);
  const sy = sd ? sd.y : new Date().getFullYear();
  const sm = sd ? sd.m : 12;
  const rows = [];
  for (const raw of lines) {
    const m = raw.trim().match(PAYLAH_LINE);
    if (!m) continue;
    const [, day, mon3, descRaw, amt, drcr] = m;
    const monn = MONTHS3[mon3.toLowerCase()];
    if (!monn) continue;
    const desc = descRaw.trim();
    if (PAYLAH_SKIP.some((p) => desc.toUpperCase().startsWith(p))) continue;
    const year = monn > sm ? sy - 1 : sy;
    const direction = drcr === "CR" ? "in" : "out";
    const value = num(amt);
    const [ftype, sign] = paylahClassify(desc, direction, rules);
    const date = iso(year, monn, +day);
    rows.push({
      date, month: date.slice(0, 7), source: "paylah",
      type: ftype, description: desc, counterparty: paylahCounterparty(desc),
      direction, amount_sgd: r2(value), spend_sgd: r2(value * sign),
    });
  }
  if (!rows.length) throw new Error("No PayLah transactions found in this PDF.");
  const key = sd ? `paylah:${iso(sd.y, sd.m, sd.d)}` : "paylah:unknown";
  return { rows, key, stmtMonth: sd ? iso(sd.y, sd.m, 1).slice(0, 7) : null };
}

// ---------------------------------------------------------------------------
// Orchestration: parse one PDF (any type) into master-CSV-shaped rows.
// ---------------------------------------------------------------------------
async function parseStatement(pdf, rules) {
  const lines = await extractLines(pdf);
  const text = lines.join("\n");
  const kind = sniffStatement(text);
  let out;
  if (kind === "paylah") out = parsePayLah(lines, text, rules);
  else if (kind === "bank") out = parseBank(lines, text, rules);
  else if (kind === "card") out = parseCard(lines, text, rules);
  else throw new Error("Doesn't look like a DBS card / bank / PayLah statement.");
  out.rows.forEach((r) => { r.statement = out.key; });
  out.kind = kind;
  return out;
}

// Legacy statement keys used by the original master CSV, so re-importing a
// month replaces the old rows instead of duplicating them.
function legacyKeysFor(kind, key) {
  const m = key.split(":")[1] || "";
  const ym = m.slice(0, 7);
  if (!ym) return [];
  if (kind === "card") return [`${ym}_statement.pdf`];
  if (kind === "bank") return [`${ym}_bank.pdf`];
  if (kind === "paylah") return [`${ym}_paylah.pdf`];
  return [];
}

function mergeRows(existing, parsed) {
  const drop = new Set([parsed.key, ...legacyKeysFor(parsed.kind, parsed.key)]);
  const kept = existing.filter((r) => !drop.has(r.statement));
  const replaced = existing.length - kept.length;
  const merged = kept.concat(parsed.rows)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.source.localeCompare(b.source)));
  return { merged, replaced };
}

// ---------------------------------------------------------------------------
// Summaries (cashflow.py + report figures) & anomalies
// ---------------------------------------------------------------------------
function cashflowSummary(rows) {
  const bank = rows.filter((r) => r.source === "bank");
  const months = {};
  for (const r of bank) {
    const g = (months[r.month] ||= { income: 0, spending: 0, invested: 0, paylahOut: 0, paylahIn: 0, winnings: 0 });
    const a = +r.amount_sgd;
    if (CF_INCOME.has(r.type)) g.income += a;
    if (CF_SPEND.has(r.type)) g.spending += a;
    if (CF_INVEST.has(r.type)) g.invested += a;
    if (r.type === FLOW.PAYLAH_OUT) g.paylahOut += a;
    if (r.type === FLOW.PAYLAH_IN) g.paylahIn += a;
    if (r.type === FLOW.WINNINGS) g.winnings += a;
  }
  return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).map(([month, g]) => {
    const spending = r2(g.spending + g.paylahOut - g.paylahIn - g.winnings);
    return { month, income: r2(g.income), spending, invested: r2(g.invested),
      net: r2(g.income - spending - g.invested) };
  });
}

function anomalies(rows, monthFilter) {
  const inScope = monthFilter ? rows.filter((r) => r.month === monthFilter) : rows;
  const out = [];
  const unknown = inScope.filter((r) => r.source === "bank" && r.type.startsWith("Other"));
  if (unknown.length) out.push({
    level: "serious", title: `${unknown.length} bank transaction(s) unclassified`,
    items: unknown.map((r) => `${r.date} · ${r.direction.toUpperCase()} S$${(+r.amount_sgd).toFixed(2)} · ${r.counterparty || r.description}`),
  });
  const uncat = inScope.filter((r) => r.type === UNCATEGORIZED && +r.spend_sgd > 0);
  if (uncat.length) {
    const tot = uncat.reduce((s, r) => s + +r.amount_sgd, 0);
    out.push({
      level: "warning", title: `${uncat.length} uncategorised merchant(s) — S$${tot.toFixed(2)}`,
      items: uncat.slice(0, 8).map((r) => `${r.date} · S$${(+r.amount_sgd).toFixed(2)} · ${r.description}`),
    });
  }
  const large = inScope.filter((r) => +r.spend_sgd >= 500);
  if (large.length) out.push({
    level: "warning", title: `${large.length} large transaction(s) ≥ S$500`,
    items: large.sort((a, b) => b.spend_sgd - a.spend_sgd).slice(0, 8)
      .map((r) => `${r.date} · S$${(+r.amount_sgd).toFixed(2)} · ${r.counterparty || r.description}`),
  });
  const bets = inScope.filter((r) => r.type === FLOW.BET).reduce((s, r) => s + +r.amount_sgd, 0);
  const wins = inScope.filter((r) => r.type === FLOW.WINNINGS).reduce((s, r) => s + +r.amount_sgd, 0);
  if (bets || wins) out.push({
    level: "good", title: `Betting net ${bets - wins >= 0 ? "loss" : "win"}: S$${Math.abs(bets - wins).toFixed(2)}`,
    items: [`Bets S$${bets.toFixed(2)} · winnings S$${wins.toFixed(2)}`],
  });
  return out;
}

// ---------------------------------------------------------------------------
// CSV import/export (master schema)
// ---------------------------------------------------------------------------
const CSV_HEADER = ["date", "month", "source", "type", "description", "counterparty",
  "direction", "amount_sgd", "spend_sgd", "statement"];

function toCSV(rows) {
  const esc = (v) => {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [CSV_HEADER.join(",")]
    .concat(rows.map((r) => CSV_HEADER.map((h) => esc(r[h])).join(",")))
    .join("\n");
}

function parseCSV(text) {
  const rows = [];
  let field = "", record = [], inQ = false;
  const pushF = () => { record.push(field); field = ""; };
  const pushR = () => { if (record.length > 1 || record[0] !== "") rows.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") pushF();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; pushF(); pushR(); }
    else field += c;
  }
  if (field !== "" || record.length) { pushF(); pushR(); }
  if (!rows.length) throw new Error("Empty CSV");
  const header = rows[0].map((h) => h.trim());
  if (!CSV_HEADER.every((h) => header.includes(h)))
    throw new Error("CSV doesn't match the transactions_master.csv format.");
  const idx = Object.fromEntries(CSV_HEADER.map((h) => [h, header.indexOf(h)]));
  return rows.slice(1).map((r) => {
    const o = {};
    for (const h of CSV_HEADER) o[h] = r[idx[h]] ?? "";
    o.amount_sgd = +o.amount_sgd; o.spend_sgd = +o.spend_sgd;
    return o;
  });
}

// ---------------------------------------------------------------------------
const Engine = {
  FLOW, SPEND_SIGN, UNCATEGORIZED,
  categorize, extractLines, sniffStatement, parseStatement, mergeRows,
  cashflowSummary, anomalies, toCSV, parseCSV,
  parseCard, parseBank, parsePayLah,
};
if (typeof module !== "undefined") module.exports = Engine;
if (typeof window !== "undefined") window.Engine = Engine;
