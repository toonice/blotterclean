function $(id) { return document.getElementById(id); }

function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  const result = cleanTrades(text);
  LAST = result.trades;
  $("detect").textContent = `Detected: ${result.broker} · ${result.trades.length} trades · ${result.dropped} rows dropped`;
  $("msg").textContent = result.warning;
  const s = summarize(result.trades);
  $("statTrades").textContent = String(s.count);
  $("statFees").textContent = money(s.fees);
  const pnlEl = $("statPnl");
  pnlEl.textContent = s.pnlRows ? money(s.pnl) : "n/a";
  pnlEl.className = "v " + (s.pnl > 0 ? "pos" : s.pnl < 0 ? "neg" : "");
  $("statDays").textContent = String(s.days);
  renderTable(result.trades);
  $("exportBtn").disabled = !result.trades.length;
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
  $("sizerOut").textContent =
    `Risk budget: ${money(risk)}\n` +
    `Stop distance: ${dist.toFixed(4)}\n` +
    `Fees / share (round trip): ${money(2 * fee)}\n` +
    `Size: ${shares} shares/contracts\n` +
    `Notional: ${money(shares * entry)}\n` +
    `1R ≈ ${money(shares * dist)} before slippage.`;
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

$("sampleSel").addEventListener("change", async (e) => {
  const file = e.target.value;
  if (!file) return;
  const res = await fetch(file);
  const text = await res.text();
  $("csv").value = text;
  runText(text);
});
