# How the Textiles Move ERP works — a study guide for the demo

A big part of the grade is explaining ERP and MRP concepts. Use this guide to learn the system and
to rehearse. Each page in the app also has a **"How this works in the ERP"** panel with the same ideas.

## The big idea
An ERP is **one database that every department works in**. Each business event is a single transaction
that updates every affected module at once:

| Event (where) | Inventory | Accounting journal | Also changes |
|---|---|---|---|
| POS sale (Point of Sale) | − stock at the store | Dr Cash · Cr Sales Revenue · Cr IGV · Dr Discounts · Dr COGS · Cr Inventory | P&L, turnover, reorder position, sales reports |
| Sales-order fulfilment | − stock at the ship location | same as a sale | backorders, MRP demand removed |
| Return (resellable) | + stock at chosen location | Dr Sales Returns · Dr IGV · Cr Cash · Dr Inventory · Cr COGS | net sales, returns report |
| Return (quality failure) | + stock in **Quality Hold** | same | quality report |
| Transfer | − from / + to | none (same value) | stock by location |
| Cycle count / damage | ± at location | Dr/Cr Inventory Adjustments vs Inventory | P&L shrinkage |
| PO receipt | + stock at receiving location, new average cost | Dr Inventory · Cr Accounts Payable | supplier scorecard (on time? full?) |
| Supplier payment | — | Dr Accounts Payable · Cr Cash | amount owed |
| Issue materials to WO | − components at workshop | Dr WIP · Cr Inventory | MRP, availability |
| Complete WO | + finished goods | Dr Inventory · Dr Scrap Expense · Cr WIP · Cr Wages Payable | production metrics, unit cost |

After every transaction the bottom-right **"What just happened"** panel shows exactly these effects.
The **Accounting Journal → Trial balance** proves debits = credits.

## The data (and where it came from)
* **Real:** 14 finished goods from the company's product sheet (names, colours, sizes, the barcodes the company already uses, SKUs) and their real stock count.
* **Team workbook:** costs, prices, BOMs with scrap allowances, lead times, 7 suppliers (6 in Lima, 1 in China), 12 customers, 6 months of sales with Peruvian seasonality (Mother's Day, Fiestas Patrias, winter long sleeves).
* **Generated:** 36 historical POs (supplier behaviour) and 34 historical work orders (scrap/rework), so the scorecard and production metrics have history to compute from.
* **Go-live:** the Nov 1, 2026 stock count is the opening balance. Earlier sales are in the P&L, but their cost is posted to *Opening Balance Equity* because that stock was gone before the count. This is how real companies go live on an ERP.

## Key formulas (all live)
* **Weighted average cost:** new avg = (on-hand × old avg + received qty × receipt cost) ÷ (on-hand + received qty).
* **Average daily demand d:** units sold (exploded through BOMs) ÷ working days (Mon–Sat) in the demand window.
* **Safety stock** = z × σ_d × √LT · **ROP** = d × LT + safety stock.
* **EOQ** = √(2 × D × S ÷ H), D = d × 312 working days, S = ordering cost (setting), H = holding % × unit cost (setting).
* **Periodic review:** order-up-to T = d(R + LT) + z σ √(R + LT); order T − position every R days.
* **Inventory position** = on hand + on order − committed to open sales orders.
* **Supplier score** = 40% on-time + 30% fill rate + 30% (quoted ÷ actual lead time); Keep ≥ 90, Watch 75–89, Replace < 75.
* **Production:** yield = good ÷ started; first-pass yield = (good − rework) ÷ started; scrap rate; on-time completion; cycle time; throughput.
* **Turnover** = COGS ÷ average inventory ((start + end) ÷ 2); days of inventory = 365 ÷ annual turnover.

## MRP in this system (same as Chapter 10)
1. **Master production schedule:** parent quantities on confirmed sales orders (status *Order Placed*) by requested week.
2. For each item, level by level (kit → tees → fabric/trims):
   `Net = Gross − Scheduled receipts − Projected on hand (prior week)`; planned receipt = L4L or FOQ lot;
   release = receipt week − lead time (in weeks).
3. A parent's **planned order releases × qty per (with scrap %)** = the component's **gross requirements** in the same week.
4. Scheduled receipts = open POs (expected date) and open work orders (due date).
5. The summary table turns each planned receipt into "order X by date Y" with Create PO / Create WO buttons.
   Past-due releases mean the order should already have been placed — expedite.

Try it: create a big sales order (e.g. 300 men's tees, CUS09) for next week, then open MRP — the tee shows a planned
work order and the black jersey, rib and labels show the dependent requirements.

## Demo rehearsal checklist (10 minutes, Dr. Wright picks the order)
* **POS:** scan two labels, add a discount, complete, show receipt → show the ripple panel → stock and P&L changed.
* **Inventory:** stock by 4 locations; transfer; cycle count with reason; backorders with estimated date.
* **Returns:** scan the receipt barcode, return one item as *Seam failure* (→ Quality Hold) and do an exchange.
* **Production:** create WO → material check → transfer short material → issue → complete with scrap + rework reasons → show report & metrics.
* **Financials:** P&L for "Since May 1", valuation by location, turnover math. Change something elsewhere and refresh the number.
* **MRP:** explain the grid row by row with the kit example (level 0 → level 1 → level 2).
* **Likely "change an input" asks:** ordering cost or holding % (Settings → EOQ changes), supplier lead time (expected date, ROP and MRP change), a sales-order quantity (MRP changes), a BOM quantity (WO consumption and cost change).
* **Wow:** the ripple panel + double-entry journal, explain-the-math popups on Replenishment, real company barcodes printed as labels, customer portal on a phone.
