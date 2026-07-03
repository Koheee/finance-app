/* UI layer — storage, rendering, file handling. Engine does the parsing. */
"use strict";

const LS_ROWS = "ft.rows.v1";
const LS_RULES = "ft.rules.v1";

let rows = load(LS_ROWS, []);
let rules = load(LS_RULES, {});
let scope = null; // month filter; null = not chosen yet -> defaults to latest month
let showAllTx = false;
let txMode = load("ft.txmode.v1", "list"); // "list" | "group" — remembered
let filt = null; // active drill-down: {kind:"cat"|"merch", value} or null

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "pdf.worker.min.js";
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- helpers ----------
function load(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
const $ = (id) => document.getElementById(id);
const fmt = (n) => "S$" + (+n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => "S$" + Math.round(+n).toLocaleString("en-SG");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(msg, ms = 3200) {
  document.querySelectorAll(".msg").forEach((e) => e.remove());
  const d = document.createElement("div");
  d.className = "msg"; d.textContent = msg;
  document.body.appendChild(d);
  if (ms) setTimeout(() => d.remove(), ms);
  return d;
}

// ---------- rendering ----------
function render() {
  const has = rows.length > 0;
  $("empty").classList.toggle("hidden", has);
  $("dash").classList.toggle("hidden", !has);
  $("rowcount").textContent = has ? `${rows.length.toLocaleString()} transactions` : "";
  if (!has) return;

  const months = [...new Set(rows.map((r) => r.month))].sort();
  if (scope === null) scope = months[months.length - 1]; // open on the latest month
  if (scope !== "ALL" && !months.includes(scope)) scope = "ALL";
  renderChips(months);

  const inScope = scope === "ALL" ? rows : rows.filter((r) => r.month === scope);
  const cf = Engine.cashflowSummary(rows);
  const cfScope = scope === "ALL" ? cf : cf.filter((c) => c.month === scope);

  // hero + tiles
  const spend = inScope.reduce((s, r) => s + (+r.spend_sgd || 0), 0);
  $("heroV").textContent = fmt(spend);
  $("heroK").textContent = scope === "ALL" ? "True out-of-pocket spending — all months" : `True spending — ${scope}`;
  const reimb = inScope.filter((r) => r.type === "Reimbursement").reduce((s, r) => s + +r.amount_sgd, 0);
  $("heroS").textContent = `after ${fmt0(reimb)} reimbursed by others`;

  // month-over-month delta — the "am I doing better?" glance
  const idx = months.indexOf(scope);
  if (scope !== "ALL" && idx > 0) {
    const prevM = months[idx - 1];
    const prev = rows.filter((r) => r.month === prevM).reduce((s, r) => s + (+r.spend_sgd || 0), 0);
    const d = spend - prev;
    $("heroD").innerHTML = d <= 0
      ? `<span class="pos">▼ ${fmt0(Math.abs(d))} less than ${prevM}</span>`
      : `<span class="negv">▲ ${fmt0(d)} more than ${prevM}</span>`;
  } else $("heroD").textContent = "";

  const inc = cfScope.reduce((s, c) => s + c.income, 0);
  const csp = cfScope.reduce((s, c) => s + c.spending, 0);
  const inv = cfScope.reduce((s, c) => s + c.invested, 0);
  const net = cfScope.reduce((s, c) => s + c.net, 0);
  $("tiles").innerHTML = [
    ["Money in", fmt0(inc), ""],
    ["Money out", fmt0(csp), ""],
    ["Invested", fmt0(inv), ""],
    ["Net saved", (net >= 0 ? "+" : "−") + fmt0(Math.abs(net)), net >= 0 ? "pos" : "negv"],
  ].map(([k, v, cls]) => `<div class="tile"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`).join("");

  // keep the List/By-merchant toggle in sync with the remembered mode
  const tm = $("txmode");
  if (tm) tm.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.mode === txMode));

  renderCashflow(cf);
  renderCats(inScope);
  renderChecks(inScope);
  renderTxns(inScope);
}

function renderChips(months) {
  const newestFirst = [...months].reverse(); // latest month sits next to "All"
  $("months").innerHTML =
    [`<button class="chip ${scope === "ALL" ? "on" : ""}" data-m="ALL">All</button>`]
      .concat(newestFirst.map((m) => `<button class="chip ${scope === m ? "on" : ""}" data-m="${m}">${m}</button>`))
      .join("");
  $("months").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { scope = b.dataset.m; showAllTx = false; render(); }));
}

function renderCashflow(cf) {
  const el = $("cfChart");
  const max = Math.max(...cf.map((c) => Math.max(c.income, c.spending)), 1);
  el.innerHTML =
    `<div class="bars">` +
    cf.map((c, i) =>
      `<div class="bgrp" data-i="${i}">
         <div class="bar b1" style="height:${(c.income / max) * 100}%"></div>
         <div class="bar b2" style="height:${(c.spending / max) * 100}%"></div>
       </div>`).join("") +
    `</div><div class="xlab">` +
    cf.map((c) => `<div>${c.month.slice(2)}</div>`).join("") + `</div>`;

  el.querySelectorAll(".bgrp").forEach((g) => {
    g.addEventListener("click", (ev) => {
      const c = cf[+g.dataset.i];
      el.querySelectorAll(".tip").forEach((t) => t.remove());
      const tip = document.createElement("div");
      tip.className = "tip";
      tip.textContent = `${c.month}: in ${fmt0(c.income)} · out ${fmt0(c.spending)} · net ${c.net >= 0 ? "+" : "−"}${fmt0(Math.abs(c.net))}`;
      const r = g.getBoundingClientRect(), er = el.getBoundingClientRect();
      tip.style.left = (r.left - er.left + r.width / 2) + "px";
      tip.style.top = "0px";
      el.appendChild(tip);
      setTimeout(() => tip.remove(), 2600);
      ev.stopPropagation();
    });
  });

  $("cfTable").innerHTML =
    `<tr><th>Month</th><th>Income</th><th>Spending</th><th>Invested</th><th>Net</th></tr>` +
    cf.map((c) =>
      `<tr><td>${c.month}</td><td>${fmt0(c.income)}</td><td>${fmt0(c.spending)}</td><td>${fmt0(c.invested)}</td>
        <td class="${c.net >= 0 ? "pos" : "negv"}">${c.net >= 0 ? "+" : "−"}${fmt0(Math.abs(c.net))}</td></tr>`).join("");
}

function renderCats(inScope) {
  const by = {};
  for (const r of inScope) {
    const v = +r.spend_sgd || 0;
    if (v > 0) by[r.type] = (by[r.type] || 0) + v;
  }
  let list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, [, v]) => s + v, 0) || 1;
  if (list.length > 8) {
    const rest = list.slice(8).reduce((s, [, v]) => s + v, 0);
    list = list.slice(0, 8).concat([["Other", rest]]);
  }
  const max = Math.max(...list.map(([, v]) => v), 1);
  $("cats").innerHTML = (list.map(([name, v]) =>
    `<div class="catrow" data-cat="${esc(name)}">
       <div class="cathead"><span class="n">${esc(name)}</span>
         <span class="a">${fmt0(v)} · ${Math.round((v / total) * 100)}% ›</span></div>
       <div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div>
     </div>`).join("") || `<div class="note">No spending in this period.</div>`);
  $("cats").querySelectorAll(".catrow").forEach((el) =>
    el.addEventListener("click", () => {
      const c = el.dataset.cat;
      if (c === "Other") return;
      filt = { kind: "cat", value: c };
      showAllTx = false; render();
      $("q").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
}

function renderChecks(inScope) {
  const monthFilter = scope === "ALL" ? null : scope;
  const items = Engine.anomalies(rows, monthFilter);
  $("checks").innerHTML = items.length
    ? items.map((f) =>
      `<div class="card check ${f.level}">
         <div class="t">${f.level === "serious" ? "🔴" : f.level === "warning" ? "🟡" : "🔵"} ${esc(f.title)}</div>
         <ul>${f.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
       </div>`).join("")
    : `<div class="card"><div class="t">✅ Nothing flagged</div></div>`;
}

// Collapse a noisy description into a stable merchant key (per analyze.py).
function normText(s) {
  let t = (s || "").toUpperCase();
  t = t.replace(/#?\d{3,}/g, "");
  t = t.replace(/\b(STORE|ONLINE|PURCHASE|MEMBERSHIP|INC|LLC|USA|COM|PTE|LTD|SGP?|REF|NO)\b/g, "");
  t = t.replace(/[^A-Z&' ]/g, " ").replace(/\s+/g, " ").trim();
  return t;
}
function normName(r) {
  if (r.source === "bank") {
    // Person-to-person and debit-card rows carry a real name/merchant;
    // for everything else the flow type IS the meaningful group.
    if (r.type === "Reimbursement") return normText(r.counterparty) || "REIMBURSEMENT";
    if (r.type === "Debit Card Spend") return normText(r.counterparty || r.description) || "DEBIT CARD";
    return r.type.toUpperCase();
  }
  if (r.source === "paylah" && r.type === "Peer payment")
    return (r.counterparty || "PEER").toUpperCase(); // keep numbers: they identify the person
  return normText(r.counterparty || r.description) || (r.description || "").toUpperCase();
}

function renderTxnsGrouped(matches) {
  const groups = {};
  for (const r of matches) {
    const v = +r.spend_sgd || 0;
    if (v === 0) continue; // transfers/mirrors aren't spending
    const key = normName(r);
    const g = (groups[key] ||= { n: 0, total: 0, type: r.type });
    g.n += 1; g.total += v;
  }
  const list = Object.entries(groups).sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  $("txns").innerHTML = list.map(([name, g]) => {
    const neg = g.total < 0;
    return `<div class="txn" data-merch="${esc(name)}" style="cursor:pointer">
      <div class="l"><div class="d">${esc(name)}</div>
        <div class="m">${g.n}× · ${esc(g.type)} ›</div></div>
      <div class="a ${neg ? "in" : ""}">${neg ? "−" : ""}${fmt(Math.abs(g.total))}</div>
    </div>`;
  }).join("") || `<div class="note">No spending to group in this period.</div>`;
  $("txns").querySelectorAll("[data-merch]").forEach((el) =>
    el.addEventListener("click", () => {
      filt = { kind: "merch", value: el.dataset.merch };
      txMode = "list"; save("ft.txmode.v1", txMode);
      showAllTx = false; render();
    }));
}

function renderTxns(inScope) {
  // active drill-down chip
  const af = $("activeFilter");
  if (af) {
    af.innerHTML = filt
      ? `<span class="filterchip">${esc(filt.value)}<button id="clearFilt" aria-label="Clear filter">✕</button></span>`
      : "";
    const cf = $("clearFilt");
    if (cf) cf.addEventListener("click", () => { filt = null; showAllTx = false; render(); });
  }

  const q = ($("q").value || "").toLowerCase();
  let matches = inScope
    .filter((r) => !q || `${r.description} ${r.counterparty} ${r.type} ${r.source}`.toLowerCase().includes(q));
  if (filt) matches = matches.filter((r) =>
    filt.kind === "cat" ? r.type === filt.value : normName(r) === filt.value);
  if (txMode === "group") { renderTxnsGrouped(matches); return; }
  let list = matches.sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = list.length;
  if (!showAllTx) list = list.slice(0, 120);
  $("txns").innerHTML = list.map((r) => {
    const spendV = +r.spend_sgd || 0;
    const isOffset = spendV < 0;
    const amt = isOffset ? "−" + fmt(Math.abs(spendV)) : spendV > 0 ? fmt(spendV) : fmt(+r.amount_sgd);
    return `<div class="txn">
      <div class="l"><div class="d">${esc(r.description)}</div>
        <div class="m">${r.date} · ${esc(r.type)} · ${r.source}${spendV === 0 ? " · not counted in spending" : ""}</div></div>
      <div class="a ${isOffset ? "in" : ""}">${amt}</div>
    </div>`;
  }).join("") +
    (total > list.length
      ? `<div style="text-align:center;padding:10px"><button id="moreTx">Show all ${total.toLocaleString()}</button></div>`
      : "");
  const more = $("moreTx");
  if (more) more.addEventListener("click", () => { showAllTx = true; render(); });
}

// ---------- file handling ----------
$("btnAdd").addEventListener("click", () => $("filePdf").click());
$("btnImport").addEventListener("click", () => $("fileImport").click());

$("filePdf").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const busy = toast("⏳ Parsing on this device…", 0);
  busy.innerHTML = `<span class="spin"></span>Parsing ${files.length} PDF(s) on this device…`;
  const results = [];
  for (const f of files) {
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const out = await Engine.parseStatement(pdf, rules);
      const m = Engine.mergeRows(rows, out);
      rows = m.merged;
      results.push(`✅ ${out.kind} (${out.key.split(":")[1]}): ${out.rows.length} txns${m.replaced ? `, replaced ${m.replaced} old` : ""}`);
    } catch (err) {
      results.push(`❌ ${f.name}: ${err.message}`);
    }
  }
  save(LS_ROWS, rows);
  busy.remove();
  toast(results.join("\n"), 6000);
  render();
});

$("fileImport").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  for (const f of files) {
    try {
      const text = await f.text();
      if (f.name.endsWith(".json") || text.trim().startsWith("{")) {
        const r = JSON.parse(text);
        if (!(r.salaryPayers || r.externalAccounts || r.overrides || r.extraCategoryKeywords))
          throw new Error("Not a rules file.");
        rules = r; save(LS_RULES, rules);
        toast("✅ Rules imported — they'll apply to statements you add from now on.");
      } else {
        const imported = Engine.parseCSV(text);
        const keys = new Set(imported.map((r) => r.statement));
        rows = rows.filter((r) => !keys.has(r.statement)).concat(imported)
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        save(LS_ROWS, rows);
        toast(`✅ Imported ${imported.length.toLocaleString()} transactions from CSV.`);
      }
    } catch (err) {
      toast(`❌ ${f.name}: ${err.message}`, 5000);
    }
  }
  render();
});

$("btnExport").addEventListener("click", () => {
  if (!rows.length) return toast("Nothing to export yet.");
  const csv = Engine.toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "transactions_master.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btnWipe").addEventListener("click", () => {
  if (!confirm("Erase all transactions and rules stored on this device? Export a CSV first if you want a backup.")) return;
  rows = []; rules = {};
  localStorage.removeItem(LS_ROWS); localStorage.removeItem(LS_RULES);
  scope = null; filt = null; render();
  toast("Erased. This device now holds no data.");
});

$("q").addEventListener("input", () => { showAllTx = false; render(); });

const txmodeEl = $("txmode"); // tolerate a stale index.html during mixed-version deploys
if (txmodeEl) txmodeEl.querySelectorAll(".chip").forEach((b) =>
  b.addEventListener("click", () => {
    txMode = b.dataset.mode; save("ft.txmode.v1", txMode);
    showAllTx = false; render();
  }));

render();
