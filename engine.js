/* BlotterClean engine — scored headers, broker fingerprints, locale numbers */
const FIELD_LEX = {
  date: ["date", "datetime", "date time", "trade date", "tradedate", "run date", "activity date", "exec time", "time", "process date", "datum", "tradezeit"],
  symbol: ["symbol", "ticker", "instrument", "underlying", "isin", "sym", "wertpapier"],
  side: ["side", "buy sell", "buysell", "buy/sell", "b/s", "bs", "action", "trans code", "transaction type", "direction", "pos effect", "seite", "richtung"],
  qty: ["qty", "quantity", "shares", "size", "filled qty", "filled", "no of shares", "no. of shares", "volume", "fill qty", "stueck", "stuck", "anzahl", "menge"],
  price: ["price", "tradeprice", "trade price", "fill price", "avg price", "average price", "price share", "price / share", "net price", "unit price", "preis", "kurs", "px"],
  fee: ["commission", "ibcommission", "fees", "fee", "comm", "comm fee", "fees comm", "fees and comm", "charge amount", "brokerage", "gebuehr", "gebuhr", "kosten"],
  fee2: ["reg fee", "fees $"],
  pnl: ["fifopnlrealized", "realized pnl", "realized p l", "realizedpl", "pnl", "result", "gain loss", "profit"],
  proceeds: ["proceeds", "amount", "net amount", "value", "total", "debit credit"]
};
const BROKERS = [
  { name: "Fidelity", need: ["run date", "action", "symbol"] },
  { name: "Schwab", need: ["fees comm", "action", "symbol"] },
  { name: "Interactive Brokers", need: ["ibcommission"] },
  { name: "Interactive Brokers", need: ["fifopnlrealized"] },
  { name: "Robinhood", need: ["trans code", "instrument"] },
  { name: "Robinhood", need: ["activity date", "trans code"] },
  { name: "Trading 212", need: ["price / share", "no of shares"] },
  { name: "Trading 212", need: ["ticker", "charge amount"] },
  { name: "thinkorswim", need: ["exec time", "pos effect"] },
  { name: "Webull", need: ["filled qty", "avg price"] },
  { name: "E*TRADE", need: ["transaction date", "transaction type"] }
];
const CASH_RE = /deposit|withdraw|transfer|interest|dividend|journal|ach|wire|cdiv|eft/i;
const TRADE_ACTION_RE = /you bought|you sold|market buy|market sell|limit buy|limit sell|\bbuy\b|\bsell\b|\bbought\b|\bsold\b|\blong\b|\bshort\b|\bbto\b|\bstc\b|\bsto\b|\bbtc\b|\bkauf\b|\bverkauf\b/i;
function norm(s) {
  return String(s || "").toLowerCase().replace(/[$()]/g, " ").replace(/&/g, " ").replace(/[^a-z0-9./]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s) { return new Set(norm(s).split(" ").filter(Boolean)); }
function scoreHeader(headerName, lexicon) {
  const n = norm(headerName);
  if (!n) return 0;
  let best = 0;
  for (const alias of lexicon) {
    if (n === alias) return 100;
    if (n.includes(alias) || alias.includes(n)) best = Math.max(best, 70);
    const a = tokens(alias); const b = tokens(n);
    let hit = 0; a.forEach((t) => { if (b.has(t)) hit++; });
    if (a.size) best = Math.max(best, Math.round((hit / a.size) * 60));
  }
  return best;
}
function detectDelim(text) {
  const line = text.split(/\r?\n/).find((l) => (l.match(/,/g) || []).length + (l.match(/;/g) || []).length + (l.match(/\t/g) || []).length >= 2) || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}
function parseCsv(text) {
  const delim = detectDelim(text);
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (q && text[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { row.push(cur); cur = ""; }
    else if ((c === "\n" || c === "\r") && !q) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((x) => String(x).trim())) rows.push(row);
      row = []; cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); if (row.some((x) => String(x).trim())) rows.push(row); }
  return { rows, delim };
}
function headerLikelihood(row) {
  const joined = row.map(norm).join(" ");
  let hits = 0;
  ["date", "datum", "symbol", "ticker", "qty", "quantity", "price", "preis", "action", "side", "commission", "instrument"].forEach((k) => { if (joined.includes(k)) hits++; });
  return hits;
}
function findHeaderIndex(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const s = headerLikelihood(rows[i]);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return bestScore >= 2 ? best : 0;
}
function mapHeader(header) {
  const idx = {}; const used = new Set();
  for (const field of Object.keys(FIELD_LEX)) {
    let bestI = -1, bestS = 0;
    header.forEach((h, i) => {
      if (used.has(i)) return;
      const s = scoreHeader(h, FIELD_LEX[field]);
      if (s > bestS) { bestS = s; bestI = i; }
    });
    if (bestS >= 50 && bestI >= 0) { idx[field] = bestI; used.add(bestI); }
  }
  return idx;
}
function detectBroker(header) {
  const bag = header.map(norm).join(" | ");
  for (const b of BROKERS) if (b.need.every((tok) => bag.includes(tok))) return b.name;
  return "Generic / unknown";
}
function parseNumber(v) {
  if (v == null || v === "") return null;
  let s = String(v).trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()\s]/g, "").replace(/^[-+]/, "").replace(/[$\u20ac\u00a3\u00a5]/g, "");
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}
function inferSide(raw, qty, proceeds) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "b" || s === "k" || s === "kauf" || s === "achat") return "BUY";
  if (s === "s" || s === "v" || s === "verkauf" || s === "vente") return "SELL";
  if (/you bought|market buy|limit buy|\bbought\b|\bbto\b|\bbtc\b|\blong\b|\bkauf\b/.test(s)) return "BUY";
  if (/you sold|market sell|limit sell|\bsold\b|\bstc\b|\bsto\b|\bshort\b|\bverkauf\b/.test(s)) return "SELL";
  if (/\bbuy\b/.test(s) && !/sell/.test(s)) return "BUY";
  if (/\bsell\b/.test(s)) return "SELL";
  if (/^b\b/.test(s) && !/s/.test(s)) return "BUY";
  if (/^s\b/.test(s)) return "SELL";
  if (qty != null && qty < 0) return "SELL";
  if (qty != null && qty > 0 && !raw) return "BUY";
  if (proceeds != null && proceeds < 0) return "BUY";
  if (proceeds != null && proceeds > 0 && qty) return "SELL";
  return "";
}
function isCashRow(symbol, action, blob) {
  const a = String(action || "");
  if (TRADE_ACTION_RE.test(a)) return false;
  if (CASH_RE.test(a) || CASH_RE.test(symbol) || CASH_RE.test(blob)) return true;
  return false;
}
function cleanTrades(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const { rows } = parseCsv(text);
  if (!rows.length) return empty("Empty file.");
  const hi = findHeaderIndex(rows);
  const header = rows[hi];
  const idx = mapHeader(header);
  const broker = detectBroker(header);
  if (idx.symbol == null && idx.qty == null && idx.price == null) return empty("Could not find a trade header row.");
  const trades = []; let dropped = 0;
  for (const r of rows.slice(hi + 1)) {
    const blob = r.join(" ");
    const symbol = idx.symbol != null ? String(r[idx.symbol] || "").trim() : "";
    const action = idx.side != null ? r[idx.side] : "";
    if (isCashRow(symbol, action, blob)) { dropped++; continue; }
    const qtyRaw = idx.qty != null ? parseNumber(r[idx.qty]) : null;
    const price = idx.price != null ? Math.abs(parseNumber(r[idx.price]) || 0) || null : null;
    let fee = 0;
    if (idx.fee != null) fee += Math.abs(parseNumber(r[idx.fee]) || 0);
    if (idx.fee2 != null && idx.fee2 !== idx.fee) fee += Math.abs(parseNumber(r[idx.fee2]) || 0);
    const pnl = idx.pnl != null ? parseNumber(r[idx.pnl]) : null;
    const proceeds = idx.proceeds != null ? parseNumber(r[idx.proceeds]) : null;
    const side = inferSide(action, qtyRaw, proceeds);
    const qty = qtyRaw == null ? null : Math.abs(qtyRaw);
    if (!symbol || (!qty && !price)) { dropped++; continue; }
    if (!side && !qty) { dropped++; continue; }
    let date = idx.date != null ? String(r[idx.date] || "").trim() : "";
    date = date.replace(";", " ");
    trades.push({ date, symbol, side: side || "?", qty, price, fee, pnl, notional: qty != null && price != null ? qty * price : null });
  }
  return { trades, dropped, broker, header: header.map(String), idx, warning: trades.length ? "" : "No trade rows after cleaning." };
}
function empty(warning) { return { trades: [], dropped: 0, broker: "\u2014", header: [], idx: {}, warning }; }
function summarize(trades) {
  const fees = trades.reduce((s, t) => s + (t.fee || 0), 0);
  const pnlKnown = trades.filter((t) => t.pnl != null);
  const pnl = pnlKnown.reduce((s, t) => s + t.pnl, 0);
  const days = new Set(trades.map((t) => (t.date || "").slice(0, 10) || "unknown"));
  return { count: trades.length, fees, pnl, pnlRows: pnlKnown.length, days: days.size };
}
