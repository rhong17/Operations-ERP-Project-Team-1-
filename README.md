# Textiles Move ERP

A private, server-backed manufacturing ERP demonstration. Platform-authenticated identity, shared D1 data, server-enforced owner/staff/customer access, and optimistic revision checks. Changes poll every five seconds; editing a form does not replace its inputs.

## Demonstration data
25 fictional textile items, 5 parent BOMs, 3 locations, 6 suppliers, 10 customers, 210 days of historical sales, PO history and work order history. Product catalog, contact information, and records are illustrative and are not imported from the company's actual operational systems. Historical sales and production records do not replay against current stock.

## Operation
1. Open while signed in as the site owner to initialize data.
2. Inventory → Barcode labels → Print labels. Print at 100%; attach to physical items.
3. Focus a barcode field and use a USB keyboard-wedge scanner with Enter suffix. Manual barcode entry works as well.
4. Settings → export backup/templates before importing actual data. Import suppliers, then items, customers, and historical sales.
5. Additional users need Site-level access granted by the owner before app roles apply. Unlisted users default to customers; the app owner assigns staff emails.
6. PO dispatch opens an email draft; the operator sends it through their mail client. No automatic email delivery or payment processing is connected.

## Financial and planning conventions
USD; net revenue excludes sales tax. A parent sale draws finished stock first and assembles remaining kits from components at checkout. Production consumes components at issue and capitalizes good-unit component cost at completion; scrap cost is expensed. Rework is a subset of good units. Defective returns stay in the return quarantine register rather than sellable quantities. Inventory losses retain COGS; resellable returns reverse original COGS and update weighted average stock cost. PO invoicing starts on first receipt. Supplier fill rate includes open orders; delivery rate and lead time use completed POs. MRP explodes confirmed parent quantities and allocates available components chronologically across four weeks. Turnover uses recorded COGS over average opening/current inventory including WIP. Ordering suggestions use historical usage, editable order cost and annual holding rate, lead time demand and safety days.

## Scope
A functional class/demo-scale ERP, not audited accounting, payroll, cash settlement or a full production deployment. One shared versioned state row keeps mutations atomic; normalized records and indexed queries would be needed for large datasets. The Site remains private unless the owner changes sharing.

## Validation
Run node scripts/test.mjs, bash scripts/build.sh, and node scripts/validate-artifact.mjs. Automated tests cover transactions, stock/financial effects, authorization, customer isolation, conflicts, and all screen/form renders. Physical scanner/printer and interactive browser testing require a supported browser/device.
