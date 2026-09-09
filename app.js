const COL_MAP = {
  date: ["date", "datetime", "date/time", "tradedate", "trade date", "settle date", "activity date"],
  time: ["time", "tradetime"],
  symbol: ["symbol", "ticker", "instrument", "underlying"],
  side: ["side", "buy/sell", "buysell", "transaction", "trans code", "type", "action"],
  qty: ["qty", "quantity", "shares", "size", "filled qty"],
  price: ["price", "tradeprice", "fill price", "avg price", "average price"],
  fee: ["commission", "ibcommission", "fees", "fee", "comm", "comm_fee"],
  pnl: ["fifopnlrealized", "realized pnl", "realized p/l", "realizedpl", "pnl"],
  proceeds: ["proceeds", "amount", "net amount", "value"],
};

const JUNK = /deposit|withdraw|transfer|interest|dividend|journal|ach|wire|fee only|balance/i;

function $(id) { return document.getElementById(id); }

function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detectDelim(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

function parseCsv(text) {
  const delim = detectDelim(text);
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (q && text[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === delim && !q) {
      row.push(cur);
      cur = "";
    } else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((x) => String(x).trim())) rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((x) => String(x).trim())) rows.push(row);
  }
  return rows;
}

function mapHeader(header) {
  const idx = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(COL_MAP)) {
      if (aliases.includes(n) && idx[field] == null) idx[field] = i;
    }
  });
  return idx;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function inferSide(raw, qty) {
  const s = String(raw || "").toLowerCase();
  if (/\bbuy\b|\blong\b|\bb\b/.test(s)) return "BUY";
  if (/\bsell\b|\bshort\b|\bs\b/.test(s)) return "SELL";
  if (qty != null && qty < 0) return "SELL";
  if (qty != null && qty > 0) return "BUY";
  return "";
}

function cleanTrades(rows) {
  if (!rows.length) return { trades: [], warning: "Empty file." };
  const header = rows[0];
  const idx = mapHeader(header);
  if (idx.symbol == null || (idx.qty == null && idx.proceeds == null)) {
    return { trades: [], warning: "Could not find symbol + qty/price columns. Check the sample files." };
  }
  const trades = [];
  for (const r of rows.slice(1)) {
    const blob = r.join(" ");
    const symbol = (r[idx.symbol] || "").trim();
    if (!symbol || JUNK.test(symbol) || JUNK.test(blob) && !/[A-Z]{1,6}/.test(symbol)) continue;
    if (JUNK.test(blob) && !num(r[idx.qty]) && !num(r[idx.price])) continue;

    const qtyRaw = idx.qty != null ? num(r[idx.qty]) : null;
    const price = idx.price != null ? num(r[idx.price]) : null;
    const fee = idx.fee != null ? Math.abs(num(r[idx.fee]) || 0) : 0;
    const pnl = idx.pnl != null ? num(r[idx.pnl]) : null;
    const side = inferSide(idx.side != null ? r[idx.side] : "", qtyRaw);
    const qty = qtyRaw == null ? null : Math.abs(qtyRaw);
    if (!qty && !price) continue;
    if (JUNK.test(blob) && !side) continue;

    let date = idx.date != null ? String(r[idx.date] || "").trim() : "";
    if (date.includes(";")) date = date.replace(";", " ");
    trades.push({
      date,
      symbol,
      side,
      qty,
      price,
      fee,
      pnl,
      notional: qty != null && price != null ? qty * price : null,
    });
  }
  return { trades, warning: trades.length ? "" : "No trade rows found after cleaning." };
}

function summarize(trades) {
  const fees = trades.reduce((s, t) => s + (t.fee || 0), 0);
  const pnlKnown = trades.filter((t) => t.pnl != null);
  const pnl = pnlKnown.reduce((s, t) => s + t.pnl, 0);
  const byDay = {};
  for (const t of trades) {
    const d = (t.date || "").slice(0, 10) || "unknown";
    if (!byDay[d]) byDay[d] = { trades: 0, fees: 0, pnl: 0 };
    byDay[d].trades += 1;
    byDay[d].fees += t.fee || 0;
    byDay[d].pnl += t.pnl || 0;
  }
  return { count: trades.length, fees, pnl, pnlRows: pnlKnown.length, byDay };
}

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}

function renderTable(trades) {
  const body = trades.map((t) => `<tr>
    <td>${esc(t.date)}</td>
    <td>${esc(t.symbol)}</td>
    <td>${esc(t.side)}</td>
    <td>${t.qty ?? "—"}</td>
    <td>${t.price != null ? t.price.toFixed(4) : "—"}</td>
    <td>${money(t.fee)}</td>
    <td class="${t.pnl > 0 ? "pos" : t.pnl < 0 ? "neg" : ""}">${t.pnl == null ? "—" : money(t.pnl)}</td>
    <td>${t.notional == null ? "—" : money(t.notional)}</td>
  </tr>`).join("");
  $("tableWrap").innerHTML = `<table>
    <thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Fee</th><th>Realized P&L</th><th>Notional</th></tr></thead>
    <tbody>${body || `<tr><td colspan="8">No trades.</td></tr>`}</tbody>
  </table>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function toCsv(trades) {
  const head = ["date", "symbol", "side", "qty", "price", "fee", "realized_pnl", "notional"];
  const lines = [head.join(",")];
  for (const t of trades) {
    lines.push([t.date, t.symbol, t.side, t.qty ?? "", t.price ?? "", t.fee ?? "", t.pnl ?? "", t.notional ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

let LAST = [];

function runText(text) {
  const rows = parseCsv(text);
  const { trades, warning } = cleanTrades(rows);
  LAST = trades;
  $("msg").textContent = warning;
  const s = summarize(trades);
  $("statTrades").textContent = String(s.count);
  $("statFees").textContent = money(s.fees);
  const pnlEl = $("statPnl");
  pnlEl.textContent = s.pnlRows ? money(s.pnl) : "n/a";
  pnlEl.className = "v " + (s.pnl > 0 ? "pos" : s.pnl < 0 ? "neg" : "");
  $("statDays").textContent = String(Object.keys(s.byDay).length);
  renderTable(trades);
  $("exportBtn").disabled = !trades.length;
}

function sizePosition() {
  const account = Number($("account").value);
  const riskPct = Number($("riskPct").value);
  const entry = Number($("entry").value);
  const stop = Number($("stop").value);
  const fee = Number($("feeShare").value || 0);
  if (![account, riskPct, entry, stop].every(Number.isFinite) || account <= 0 || riskPct <= 0) {
    $("sizerOut").textContent = "Fill account, risk %, entry, and stop.";
    return;
  }
  const risk = account * (riskPct / 100);
  const dist = Math.abs(entry - stop);
  if (dist === 0) {
    $("sizerOut").textContent = "Entry and stop cannot be the same.";
    return;
  }
  const perShare = dist + 2 * Math.max(0, fee);
  const shares = Math.floor(risk / perShare);
  const notional = shares * entry;
  const rMultipleAt1 = dist;
  $("sizerOut").textContent =
    `Risk budget: ${money(risk)}\n` +
    `Stop distance: ${dist.toFixed(4)}\n` +
    `Fees / share (round trip): ${money(2 * fee)}\n` +
    `Size: ${shares} shares/contracts\n` +
    `Notional: ${money(notional)}\n` +
    `If target is 1R away, 1R ≈ ${money(shares * rMultipleAt1)} after the stop distance, before extra slippage.`;
}

$("file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  $("csv").value = await f.text();
});

$("parseBtn").addEventListener("click", () => runText($("csv").value));
$("sizeBtn").addEventListener("click", sizePosition);
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([toCsv(LAST)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "blotter-clean.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("sampleBtn").addEventListener("click", async () => {
  const res = await fetch("samples/generic.csv");
  const text = await res.text();
  $("csv").value = text;
  runText(text);
});
