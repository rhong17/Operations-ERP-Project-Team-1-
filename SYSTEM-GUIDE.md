# Textiles Move ERP: how it works

A plain-English map of the code, written for the team. Line numbers refer to `worker/domain.mjs` unless a different file is named.

## 1. The big picture

```
Browser (worker/index.html)            Server (worker/server.mjs)             Database (Cloudflare D1)
 - draws every screen          GET /api/state  ->  loads the data           one table: erp_state
 - polls every 5 seconds       POST /api/action -> runs act() in domain.mjs one row (id = 1)
 - sends actions like "sale"                       saves the whole thing     column `data` = ALL data as JSON
```

- **The entire database is one JSON blob** in one row: items, sales, POs, work orders and everything else. Each save bumps a `revision` number. If two people save at the same moment, the second one gets "Another user updated the data", which is how multi-user consistency (#12) works.
- **Saves are all-or-nothing.** The server applies an action to a copy of the data and writes it only if nothing failed. A rejected sale never half-reduces stock.
- **Every number you see is calculated live** from that JSON by four functions: `metrics()`, `planning()`, `mrp()` and `score()`. None of them is typed in by hand.
- **Logins come from ChatGPT.** ChatGPT's hosting passes the signed-in user's ID and email to the server (`server.mjs`). The first person who ever opened the site became the **owner**. Emails listed under Settings are **staff**, and everyone else is a **customer**.

## 2. The files

| File | What it is | Edit it? |
|---|---|---|
| `worker/domain.mjs` | **The ERP brain**: seed data, every transaction, every formula | Yes, most logic changes go here |
| `worker/index.html` | Every screen, the styles, and the browser-side math for production metrics | Yes, for anything visual |
| `worker/server.mjs` | Login, roles, permissions, saving | Rarely |
| `worker/index.js` | **Generated** bundle of the three files above | Never by hand; rebuild it |
| `drizzle/0000_erp.sql` | Creates the single `erp_state` table | No |
| `scripts/test.mjs` | Automated tests | Run after changes |
| `README.md`, `DOWNLOAD-GUIDE.md` | ChatGPT's own notes | Read only |

## 3. Every action the system can do (`act()`, lines 26–49)

| Action | Line | What it does | Rubric |
|---|---|---|---|
| `sale` | 25, 27 | Groups lines, reduces stock via `take()`, records revenue, COGS and tax. A parent item uses finished stock first, then **assembles the rest from components at checkout** (line 24) | #1 |
| `transfer` | 28 | Moves stock out of one location and into another | #2 |
| `adjust` | 29 | Changes stock with a reason code: Cycle count, Damage, Quality failure or Supplier receipt. A decrease is booked as an inventory loss in COGS | #2 |
| `order` | 30 | Creates a sales order with status Order Placed | #4, #11 |
| `orderStatus` | 31 | Order Placed → Fulfilled (runs a real `sale`) → Closed, or Order Placed → Cancelled | #4 |
| `return` | 32 | Must match an original sale. A **resellable** return goes back into stock and reverses revenue and COGS. A **quality failure** (Seam failure, Fabric defect, Damaged) reverses revenue, keeps the cost as a loss and is quarantined rather than restocked. An optional exchange item creates a new sale | #5 |
| `production` / `issue` / `complete` | 33–35 | Create work order → issue (consumes the BOM components and records the start time) → complete (good, scrap, rework, reason, finish time). Good units are valued at the rolled-up component cost, and the scrap cost is expensed | #6 |
| `po` / `receive` / `poClose` / `pay` | 36–39 | Expected date = sent date + supplier lead time. Partial receipts are allowed, and each receipt updates the weighted-average cost | #7 |
| `supplier`, `settings`, `user`, `import` | 40–49 | Edit suppliers, edit EOQ inputs, set user roles, bulk-import real data | #7, setup |

## 4. The formulas (what to explain to Dr. Wright)

**Financials: `metrics()`, line 51**
- Net revenue = sum of `revenue` across all sales, returns and losses
- Gross profit = revenue − COGS (COGS includes damage and scrap)
- Inventory value = Σ (on-hand quantity × weighted average cost)
- Turnover = COGS ÷ average of (opening inventory value, current value + WIP)

**Reorder point and EOQ: `planning()`, line 52**
- Daily usage = units sold in the last 183 days ÷ 183. Component usage comes from exploding parent sales through their BOMs.
- ROP = max(item's own ROP setting, daily usage × (lead time + safety days))
- EOQ = √(2 × annual demand × order cost ÷ (unit cost × holding rate))
- Suggested quantity = max(EOQ, shortfall), but only when on hand + on order ≤ ROP

**MRP: `mrp()`, line 53**
1. Take open sales orders due within the next 28 days.
2. Multiply each parent quantity through its BOM to get gross component needs.
3. Sort the needs by date, then subtract on-hand stock and any open PO expected by that date.
4. Suggested order = what's left. Order-by date = required date − component lead time.

**Supplier scorecard: `score()`, line 55**
- On-time % = completed POs whose last receipt is on or before the expected date
- Actual lead time = average days from sent to last receipt
- Fill rate = units received ÷ units ordered (open POs included)
- Owed = value received − amount paid
- Rating: **Keep** = ≥85% on time and ≥85% fill; **Watch** = ≥60% on time; **Replace** = below that

## 5. Gaps I verified in the code

| # | Problem | Where | Why it matters |
|---|---|---|---|
| A | **No page lists the AI tools and database used** | `index.html` | Explicitly required by the rubric |
| B | **Sales history is a repeating formula**: exactly 2 sales a day, item = `(day×7+k) mod 5`, quantity cycles 1 to 4. No seasonality, no trend, and only the 5 parent items ever sell | line 15 | The rubric says flat or patterned data "will be obvious" |
| C | **All 6 suppliers share one PO pattern**: every 4th PO is 3 days late, PO #4 is short 8 units, and every PO is 100 units. That's why every scorecard reads 71.4% / 86.5% | line 16 | The scorecard can't tell suppliers apart |
| D | **All 5 BOMs are nearly the same**: 2 fabric + thread + care label + brand label + hang tag + mailer. **10 of the 20 components (webbing, zip, buttons, D-ring, elastic, cord and others) are in no BOM**, so their usage and EOQ are 0 | line 13 (`bom:`) | A tote with no straps and an organizer with no zip; MRP looks thin |
| E | **MRP doesn't net finished goods.** A 400-apron order explodes all 400 into components even though 81 aprons are on the shelf | line 53 | A good MRP question to expect in the demo |
| F | Customers can only order the **first 5 items** in the list (hard-coded `<5`) | `server.mjs` line 5 | Breaks if the real catalog is imported in a different order |
| G | Two BYU emails are **hard-coded as staff** | `server.mjs` line 3 | Fine for class |
| H | US dollars and 6% tax. Peru uses soles (PEN) and 18% IGV | line 11, settings | Change once real data goes in |
| I | Seed work orders and POs are all at Main Workshop with uniform quantities | lines 16–18 | Same "too uniform" risk |

## 6. How to make a change

The live site runs on **ChatGPT Sites**, so a change has to be republished through ChatGPT. The workflow:

1. Edit the files in this folder (with Claude Code).
2. Run the tests: `node scripts/test.mjs` (needs Node.js 24+; `brew install node`).
3. Rebuild: `bash scripts/build.sh`, then `node scripts/validate-artifact.mjs`.
4. In the ChatGPT chat that built the site, upload or paste the changed files and ask it to "replace these files and republish."

**Important: changing the seed data (gaps B, C, D, I) does nothing to the live site**, because `seed()` runs only the first time the database is empty. To get new seed data live, either:
- Generate the improved data and load it through **Settings & data → Import data** (download a backup first), or
- Ask ChatGPT to reset the database so the new `seed()` runs. **This erases everything currently in the live site.**

## 7. Loading the real company data

Settings & data → **Download data backup** first, then **Download import templates**. Import in this order:
1. **Suppliers**: `id, name, email, phone, lead, terms`
2. **Items**: `id, name, barcode, cost, price, rop, lead, supplier, stock:[qty per location], bom:[{item, qty}]`. Single-level BOMs only, and barcodes must be unique. Importing items **replaces stock quantities**.
3. **Customers**: `id, name, email`
4. **Sales history**: `id, date, kind:"sale", lines:[{item, qty, price, cost}], revenue, cogs, tax`. Importing history does not change current stock.

Real sales history automatically fixes gap B and gives you real EOQ and reorder points. Real PO history fixes gap C.
