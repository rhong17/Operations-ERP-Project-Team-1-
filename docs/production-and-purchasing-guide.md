# Production, Purchasing & Suppliers: Riley's guide

Owner: Riley · Covers rubric items **#6 Production Orders** and **#7 Purchase Orders and Suppliers**
Code: `worker/domain.mjs` (logic) and `worker/index.html` (screens) · Checked against the live site on 2026-11-14

> **⚠ Status of the new production features (updated 2026-11-14).** Part 2 describes four new work order features: **material check, cancel, actual start/finish times, and per-issue quality reasons.** They're built and tested on Riley's Mac (on the local branch `production-improvements`), but **not pushed to GitHub and not on the live site yet**. Until the Codex teammate republishes them, the live ERP still behaves the old way: no cancel button, click-only times, and one reason per work order.

---

## Part 1: The big idea (explain this first in the demo)

Textiles Move **buys** raw materials (fabric, thread, labels, packaging) from suppliers and **makes** finished products (totes, aprons, cushion covers, organizers, table runners) in its own workshop. These two modules are the two halves of that:

```
 SUPPLIERS ──PO──▶ RAW MATERIALS ──Work order──▶ FINISHED GOODS ──Sale──▶ CUSTOMERS
 (Purchasing)      (component stock)  (Production)   (finished stock)
```

- **Purchasing** brings components *into* inventory, at a cost, from a supplier, by a date.
- **Production** turns components *into* finished goods, using the **bill of materials (BOM)**, the recipe for one unit.
- **Everything posts automatically.** Stock changes at the chosen location, the item's average cost updates, and Financial reports, MRP and the supplier scorecards recalculate. Nobody types a number into a report. This is the core ERP point: one transaction updates every department's view.

### The 5 bills of materials (current demo data)
Every finished product uses **2 units of its fabric + 1 thread + 1 care label + 1 brand label + 1 hang tag + 1 mailer.**

| Finished item | Fabric (×2) | Material cost per unit |
|---|---|---|
| Organic Canvas Tote | Cotton Canvas · Natural | $10.70 |
| Everyday Apron | Cotton Canvas · Sage | $11.30 |
| Linen Cushion Cover | Linen · Oat | $14.70 |
| Travel Organizer | Cotton Twill · Navy | $11.70 |
| Cotton Table Runner | Cotton Lining | $8.10 |

---

## Part 2: Production orders (work orders)

### Vocabulary
| Term | Meaning |
|---|---|
| **Work order (WO)** | An instruction to make X units of one product at one location |
| **Issue materials** | Physically pull the components off the shelf. The system subtracts them from stock |
| **Quantity started** | How many units you set out to make (the WO quantity) |
| **Good** | Units that passed inspection and go into sellable stock |
| **Scrap** | Units that are ruined. Their material cost is written off as a loss |
| **Rework** | Units that failed the first time but were fixed. They are **counted inside Good** |
| **Rolled-up cost** | The cost of a finished unit = the cost of the components that went into it |
| **Material availability check** | Comparing what the BOM needs against what's on the shelf at that location, *before* committing to the job |
| **Quality issue** | One problem on one or more units: a type (Scrap or Rework), a quantity and a reason |

### The lifecycle
```
Planned  ──[Issue materials]──▶  In Progress  ──[Complete]──▶  Completed
(nothing moves yet)         (components leave stock,    (good units enter stock,
   │                         start time stamped)          scrap expensed, times recorded)
   │                                │
   └──────[Cancel]──────────────────┴──[Cancel]──▶  Cancelled
     (nothing to undo)         (issued materials go back on the shelf)
```

### How to use it (step by step)

**1. Production → ＋ Create work order.** Pick a product (only items with a BOM appear), a location and a quantity.
   - **Material check (new):** as you change the product, location or quantity, a live table appears under the form. For every material in the recipe it shows **Need**, **Have here** and **Status** (Ready, or Short N), plus "**You can make up to N here.**"
   - If something is short, it tells you where else that material is and offers two one-click fixes:
     - **Transfer N from [location]** opens the transfer form already filled in (material, from, to, quantity). After you confirm, you land **back on your work order**, now all green.
     - **Create PO · arrives ~date** opens a purchase order already filled in (right supplier, shortfall quantity, delivered to this location). The date is today + the supplier's lead time.
   - **Short is a warning, not a block.** You can still click **Create planned order**, because real shops plan jobs before the materials arrive. The hard stop happens later, at Issue materials.
   - *Behind the scenes:* a WO is created with status **Planned**. **Nothing moves yet.**
   - *Example (live data):* 10 totes at Main Workshop need 20 Natural canvas, but Main has 14 → "Short 6 · You can make up to 7 here · North Warehouse has 18 → [Transfer 6 from North Warehouse]."

**2. Click Issue materials** on that row.
   - *Behind the scenes:* for every BOM line, the system subtracts quantity × BOM quantity from that location's stock. It records the cost of those components as the WO cost and stamps the **start time**. Status becomes **In Progress**.
   - *Example:* a WO for 10 totes pulls 20 Natural canvas, 10 thread, 10 care labels, 10 brand labels, 10 hang tags and 10 mailers. WO cost = $107.00.
   - If any component is short at that location, it refuses with "Insufficient stock: X at Y" and **nothing** is taken. It's all or nothing.

**3. Click Complete.** The form has three parts:
   - **Times (new):** **Started at** is filled in with the moment materials were issued, and **Finished at** with right now. If those clicks match reality, leave them. If the supervisor is entering the job afterwards, type the real shop times. **Production time** updates live (e.g. "4.5 hours").
     - Rules: finish must be after start, finish can't be in the future, and the start can't be more than 30 days ago.
     - If you change the times, the row shows a **✎**. Hovering it shows the original click times, and the audit log keeps both, so nobody can quietly fudge them.
   - **Quantities:** **Completed good**, **Scrapped**, **Reworked**. Good + scrap must equal quantity started. Typing a scrap number fills in good for you (started − scrap). Rework is a subset of good (fixed units) and can't exceed it.
   - **Quality issues (new):** one line per problem, each a **type** (Scrap/Rework), **units** and **reason** (Seam failure, Fabric defect, Cutting error, Machine issue). Click **＋ Add issue**; each new line pre-fills the type and quantity still unexplained. A checklist shows "Scrap: 2 of 2 explained ✓ · Rework: 1 of 1 explained ✓". The lines **must add up** to the scrap and rework totals or the form won't save. With no scrap or rework, leave it empty.
   - *Behind the scenes:*
     - Good units are **added** to stock at that location.
     - The item's **weighted average cost** is updated: `(old cost × units on hand + cost of good units) ÷ (units on hand + good units)`.
     - The cost of scrapped units becomes a **"production scrap" loss** in Cost of Goods Sold on the P&L.
     - The start and finish times are saved, every quality issue is stored separately, and status becomes **Completed**.
   - *Example:* 10 started → 8 good, 2 scrap (1 Seam failure, 1 Fabric defect), 1 rework (Cutting error), 8:00 AM → 12:30 PM. Tote stock +8. Inventory value +$85.60 (8 × $10.70). P&L loss +$21.40 (2 × $10.70). The row reads "Scrap 1: Seam failure; Scrap 1: Fabric defect; Rework 1: Cutting error."

**4. Cancel (new).** Planned and In Progress rows have a **Cancel** button. Completed orders can't be cancelled, because their finished goods may already be sold.
   - Pick a reason: **Entered by mistake**, **Order cancelled** or **Materials needed elsewhere**. The buttons read **Keep work order** / **Confirm cancellation**, so it's hard to do by accident.
   - **Planned:** nothing moved, so nothing is undone. It's just marked Cancelled.
   - **In Progress:** the form lists every material that will go back on the shelf (e.g. "Cotton Canvas · Sage 10"). They return to the WO's location at the **same cost they left at**, so work in progress drops back to $0 and inventory value is unchanged.
   - The order **stays in the list, greyed out**, as a record. It's **left out of all production metrics** and logged in the audit history with the reason.

### Why each new feature matters (say this in the demo)
| Feature | Business reason | ERP/MRP concept it shows |
|---|---|---|
| Material check | Find shortages before committing to a job; supervisors see the fix in seconds | **Component availability check**: BOM × quantity vs on-hand by location, which is MRP netting in miniature |
| Transfer / Create PO shortcuts | One screen connects production, inventory and purchasing | **Integration**: one shared database across departments |
| Cancel with material return | Mistakes happen; inventory and WIP stay accurate | **Reversing transactions** instead of deleting them, keeping an audit trail |
| Actual start/finish times | Throughput reflects the real shop floor, not when someone clicked | **Data accuracy at the source** |
| Per-issue quality reasons | Shows which problems cost the most, e.g. fabric defects pointing to a supplier | **Quality data** you can act on (Pareto analysis of defect causes) |

### The 4 production metrics (top of the Production page)
They're all calculated from **completed** work orders in the chosen date range. **Cancelled orders are excluded.**

| Metric | Formula | What it tells a manager |
|---|---|---|
| **Good yield** | good ÷ started | Share of what we start that we can sell |
| **First-pass yield** | (good − rework) ÷ started | Share done right the *first* time, without fixing |
| **Scrap rate** | scrap ÷ started | Share of material and effort thrown away |
| **Throughput** | good units ÷ production hours (from the recorded start and finish times) | Output speed |

**Production report:** set the start and end dates, and the table and all 4 metrics filter to work orders *started* in that range. **Export report** downloads them as a CSV, including each order's quality issues, the cancel reason and any edited times.

**Times are shown in your computer's local time.** (Before, they showed in UTC, 7 hours ahead of Utah.) Side effect: the fake history work orders were stored as 8:00 AM UTC, so they now appear as **~1:00–5:00 AM** in Utah. This goes away when the demo data is regenerated.

### How production connects to the rest of the ERP
- **Inventory:** components go down at issue, finished goods go up at completion.
- **Financials:** inventory value moves from components to finished goods. Scrap hits COGS. In-progress material shows as **Work in progress** on the P&L page.
- **Selling without a work order:** if a customer buys a product that has no finished stock at that location, the POS **assembles it from components at checkout**. It still consumes the BOM, just without a WO. Know this in case Dr. Wright sells something that's out of stock.

---

## Part 3: Purchase orders

### The lifecycle
```
Order Sent ──[Receive, can be partial]──▶ Received ──[Close]──▶ Closed
     │                                       (all units in)
     └── Payment due date starts counting on the FIRST receipt (Net 30, etc.)
```

### How to use it
1. **Purchase orders → ＋ Create & send PO.** Pick a **supplier**. Only items assigned to that supplier appear in the line dropdown. Then pick the **delivery location**, add lines and quantities.
   - The **Expected receipt** date is filled in automatically: **today + the supplier's quoted lead time.**
   - Click **Create PO & open send draft**. Status is **Order Sent**, and a PO document opens. **Open email draft** creates a pre-written email to the supplier in your mail app (it does *not* send by itself). **Print PO** prints it.
2. **Receive.** Click **Receive** on the PO. The banner shows *Expected vs Today → On time / Late*. You can **scan the item's barcode**, choose **which location** it goes into, and enter the quantity.
   - Partial receipts are allowed (for example 30 of 50 now, 20 later). You can't receive more than is outstanding.
   - *Behind the scenes:*
     - Stock goes up at that location.
     - The item's weighted average cost updates.
     - The receipt **date** (today) and quantity are saved on the PO.
     - The first receipt starts the **invoice clock** (due = first receipt + Net days).
     - When every line is fully received, status becomes **Received**.
3. **Pay.** When a balance is owed, a **Pay** button appears. Enter the amount (it can't exceed what's owed).
4. **Close.** Once **Received**, click **Close**. Closed means "done, nothing more expected."

### Suppliers page and scorecard
**＋ Add supplier / Edit supplier:** name, email, phone, **quoted lead time (days)**, **payment terms (Net days)**.

Each supplier card is calculated from PO history:

| Measure | Formula |
|---|---|
| **On-time delivery** | completed POs whose *last* receipt was on or before the expected date ÷ completed POs |
| **Actual lead time** | average days from PO sent to last receipt (compare with **Quoted lead time** right below it) |
| **Fill rate** | units received ÷ units ordered, across all that supplier's POs (open ones included) |
| **Outstanding balance** | value received − amount paid |
| **Next payment due** | earliest unpaid PO's first receipt date + Net days |
| **Rating** | **Keep** = ≥85% on time *and* ≥85% fill · **Watch** = ≥60% on time · **Replace** = under 60% · **Unrated** = no completed POs |

**Payments & due dates** opens a per-PO breakdown of received value, paid, owed and due date.

### Ordering rules (also part of #7, on the Manager reports page → Replenishment review)
| Number | Formula | Inputs you can change |
|---|---|---|
| **Daily usage** | units sold in the last 183 days ÷ 183 (component usage = parent sales × BOM quantity) | sales history |
| **Reorder point (ROP)** | max(item's ROP setting, daily usage × (lead time + safety days)) | Settings → safety days |
| **EOQ** | √(2 × annual demand × cost per order ÷ (unit cost × holding rate)) | Settings → cost per PO, holding rate |
| **Suggested qty** | if on hand + on order ≤ ROP → max(EOQ, shortfall) | — |

> **EOQ in plain English:** ordering often costs a lot in order fees; ordering rarely costs a lot in money tied up in stock. EOQ is the order size where those two costs balance. Raise the cost per order and EOQ goes up (order bigger, less often). Raise the holding rate and EOQ goes down.

**Heads-up:** changing **Settings** requires the **owner** account. On the live site you (Riley) are signed in as **staff**, so you can't change the EOQ inputs yourself during the demo. Plan for the owner to do it, or ask them to make you owner.

---

## Part 4: Requirement check

✅ = meets it · ⚠️ = technically there but fragile in a demo · ❌ = missing

### #6 Production Orders
| Requirement | Status |
|---|---|
| Create WO with item, quantity, location | ✅ |
| Issuing consumes components per BOM | ✅ |
| Completing receives finished goods at rolled-up cost | ✅ (materials only, no labor) |
| Qty started / good / scrapped / reworked + reason code | ✅ now one reason per problem (local build, not live yet) |
| Start and finish times | ✅ actual times can be entered and are validated (local build; live site still uses click times) |
| *(extra)* Cancel a work order | ✅ with material return (local build, not live yet) |
| *(extra)* Material availability check | ✅ with transfer/PO shortcuts (local build, not live yet) |
| ≥3 production and quality metrics | ✅ (4) |
| Production report over a date range | ✅ (filter + CSV) |

### #7 Purchase Orders & Suppliers
| Requirement | Status |
|---|---|
| Add/edit suppliers with contact, quoted lead time, terms | ✅ |
| Create and send POs | ✅ (email draft) |
| Receive against PO into a chosen location, recording date and qty | ✅ (date is always today) |
| Status Order Sent → Received → Closed | ⚠️ a short-shipped PO can never close (P6) |
| Expected date from lead time; compare actual vs expected | ✅, but overdue unreceived POs are ignored (P3) |
| Reorder point incorporating lead-time demand | ⚠️ a fixed number overrides it for 11 of 13 items (P1) |
| Periodic manual review | ⚠️ a review table exists; no review period |
| EOQ from sales history with editable order and holding costs | ✅ (0 for components in no BOM) |
| Scorecard from PO history | ⚠️ works, but all 6 suppliers look identical (P4) |
| Payment tracking (owed + due dates) | ✅, overdue not highlighted (P9) |
| Overall rating per supplier | ✅ |

---

## Part 5: Issues found (tested in code and on the live data)

### 🔴 High: likely to come up in a live demo
| # | Issue | Proof | Proposed fix |
|---|---|---|---|
| **P1** | **The reorder point shown is a fixed number, not a calculation, for 11 of 13 items.** The formula is max(fixed setting, calculation), and the fixed 80 or 18 almost always wins. If Dr. Wright says "change safety days and show the new ROP," nothing changes. | Sage canvas: calculated 29, shown 80 | Use the calculated ROP (lead-time demand + safety stock). Show the parts (lead-time demand, safety stock) in the table |
| **P2** | **Editing a supplier's lead time doesn't affect planning.** POs use the *supplier's* lead time, but ROP and MRP order-by dates use a separate copy stored on each *item*. | Changed Carolina 7 → 30 days: PO expected date changed, Sage ROP and order-by didn't | Read lead time from the item's supplier, so there's one source of truth |
| **P3** | **Late, unreceived POs don't count as late.** All 6 open POs are 5–14 days past their expected date, yet on-time % ignores them. A supplier that never delivers looks fine. | PO-1007 expected 10-31, still 0/100 | Count open POs past their expected date as late in the scorecard, and flag them **Overdue** on the PO list |
| **P4** | **All 6 supplier scorecards are identical** (71.4% / 86.5% / Watch), because the demo PO history uses one pattern for every supplier. | Suppliers page | Regenerate PO history so each supplier has its own reliability profile, producing a mix of Keep, Watch and Replace |
| **P5** | **A newly added supplier can't receive a PO.** Items can only be assigned to a supplier through JSON import, so a new supplier has no items. | "Item supplier mismatch" | Add a "Supplier" field when editing an item, or let a PO line use any purchased item |
| **P6** | **A PO the supplier short-ships can never be closed.** Close requires *every* unit received, so the PO sits at Order Sent forever and its missing units count as "on order" in MRP and ROP. | "Receive all items first" | Add **Close short** (records the shortfall, which also lowers the fill rate) |

### 🟡 Medium: correctness and realism
| # | Issue | Proposed fix |
|---|---|---|
| **P7** | The PO price is locked to the item's current average cost. You can't enter the supplier's quoted price, so purchases never move weighted average cost | Editable unit cost on each PO line |
| **P8** | Finished products (tote, apron and so on) are assigned to fabric suppliers and can be put on a PO | Only allow purchased components on POs |
| **P9** | Overdue supplier payments aren't highlighted (Carolina's next payment was due 11-08) | Red **Overdue** tag on the supplier card and payments list |
| **P10** | Fill rate includes open POs that aren't due yet, which penalizes a supplier for orders it hasn't had time to fill | Count only units on received/closed or overdue POs |
| ~~**W1**~~ | ✅ **Built (local, not pushed):** Cancel for Planned and In Progress WOs; issued materials are returned | — |
| ~~**W2**~~ | ✅ **Built (local, not pushed):** actual start/finish times on Complete, validated and audited | — |
| **W3** | The demo products' starting cost doesn't match their BOM cost (cushion cover $11 vs $14.70 in materials). The first production run jumps the average cost noticeably | Set starting cost = BOM cost (+ optional labor) |
| **W4** | MRP ignores work orders: planned WOs don't create component demand, and in-progress WOs don't count as incoming finished goods | Include WOs in MRP |
| ~~**W6**~~ | ✅ **Built (local, not pushed):** one line per quality problem (type + units + reason); "Rework completed" removed | — |
| **W8** | Demo WO history is uniform: all at Main Workshop, all exactly 4 hours, and every defect is "Seam failure" | Vary it when the demo data is regenerated |
| **W9** | *(new)* Natural canvas is supplied by **Atlas Hardware** in the demo data, so the material check's PO shortcut orders fabric from a hardware supplier | Fix supplier assignments when the demo data is regenerated |
| **W10** | *(new)* Times now show in local time, so the demo history (stored as 8:00 AM UTC) appears as ~1:00–5:00 AM in Utah | Store realistic shop hours when the demo data is regenerated |
| — | *(also fixed while testing)* The Production page's end-date filter and the transfer form's Destination shared one internal ID, which would have pre-filled the wrong destination | Fixed in the local build |

### 🟢 Demo prep (live data, no code change needed)
- **Totes can barely be made:** only 7 at Main Workshop, 9 at North Warehouse, **0 at Downtown Pickup** (not enough Natural canvas). Other products can do ~115 at Main and ~20 at Downtown. **Demo production at Main Workshop**, or receive a canvas PO first, which is a nice story that connects both modules. *Once the new build is live,* the material check turns this into a strength: ask for 10 totes, show "Short 6," and fix it with the Transfer button.
- **PO-1057 has 1 of 100 received** (someone tested it). It's fine, but you'll see a $0.70 balance.
- **All 6 open POs are overdue.** If you receive one in the demo, it will say **Late**. That's good to explain, but expect it.
- You're **staff**, not owner, on the live site, so you can't change Settings (P1/EOQ demos).

---

## Part 6: 3-minute demo script (once fixes are in)

1. **"We buy fabric."** Suppliers → show a scorecard: on-time %, actual vs quoted lead time, fill rate, money owed, rating → *"a manager can decide keep / watch / replace."*
2. **"We're low on canvas."** Manager reports → replenishment: daily usage → ROP → EOQ. Change the cost per order in Settings and show EOQ change.
3. **Create a PO** for Natural canvas → expected date = today + lead time → open the email draft.
4. **Receive** part of it by **scanning the barcode** into Main Workshop → show stock go up and the PO show partial → explain on-time vs late.
5. **"Now we make totes."** Production → ＋ Create work order for 10 totes at Main Workshop → point at the **material check**: *"the system checks the bill of materials against the shelf before we commit."* If it's short, click **Transfer** and show it return to the work order, all green → **Create planned order**.
6. **Issue materials** → show canvas drop by 20 → *"materials have left the shelf and are now work in progress."*
7. **Complete** → set **Started at** to this morning (*"the supervisor records actual shop times"*) → 8 good, 2 scrap, 1 rework → **＋ Add issue** for each problem: 1 Seam failure, 1 Fabric defect, 1 Cutting error → *"every problem gets its own reason, so we know which ones cost us most, and fabric defects point back to the supplier."*
8. Show the **metrics update** (yield, first-pass yield, scrap rate, throughput from the real hours), then Financial reports: inventory value and the scrap loss in COGS.
9. *If asked "what if you made a mistake?":* create a WO, issue it, **Cancel** with "Entered by mistake" → *"the materials go back on the shelf at their original cost, and the record stays for the audit trail."*
