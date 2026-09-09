# BlotterClean

Paste or upload a messy broker CSV. Get a clean trade blotter.

- Detects common column names (`symbol`, `qty`, `price`, `commission`, `buy/sell`, dates)
- Drops deposits, withdrawals, and junk rows when it can
- Shows day P&L when a realized P&L column exists
- Fee-aware position sizer
- Export cleaned CSV — files stay in your browser

Not tax software. Not a broker. Check numbers against your statement.

## Run locally

Open `index.html` in a browser. No build step.

Or serve it:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Sample files

- `samples/generic.csv` — simple 8-column blotter
- `samples/ibkr_flex_like.csv` — IBKR Flex-style headers

## Position size

`shares = risk_dollars / ( |entry - stop| + fees_per_share_round_trip )`

Fees are optional. If omitted, size is risk / stop distance.

## License

MIT
