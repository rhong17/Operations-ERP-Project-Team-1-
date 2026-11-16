# Working on the ERP as a team (with AI)

**Short version:** everyone uses the same live site and database, but makes code changes on their
own branch, on their own time, with whatever AI coding tool they like. A pull request (PR) brings
a change into `main`, and merging the PR publishes the site automatically.

## Why GitHub works for this

| Need | How it's handled |
|---|---|
| Everyone can use the ERP | One public website (GitHub Pages) + email logins (Supabase). No ChatGPT/Codex account needed. |
| Edit individually, any time | Each person works on a **branch** — your half-finished work never breaks the live site. |
| Edit with AI | Claude Code, Codex, Cursor, Copilot… all read the repo. `CLAUDE.md` / `AGENTS.md` tell the AI the project rules. |
| No one person is a bottleneck | Merging to `main` auto-deploys. Anyone with access can merge. |
| Safety | Every PR is built and the MRP/ROP/EOQ math is re-checked automatically before it can deploy. Old versions stay in history. |

## First time (each teammate, ~10 minutes)

1. Accept Riley's GitHub collaborator invite (email).
2. Install **Node.js 20+** (nodejs.org) and **Git**. Easiest path: install **GitHub Desktop**.
3. Clone the repo: GitHub Desktop → *File → Clone repository* → `rhong17/Operations-ERP-Project-Team-1-`
   (or `git clone https://github.com/rhong17/Operations-ERP-Project-Team-1-.git`).
4. In the project folder run `npm install`, then `npm run dev` and open http://localhost:5173.
   This local copy talks to the **real shared database**, so anything you do there is real (use Reset demo data if you make a mess).

## Every change

1. **Get the latest:** `git checkout main && git pull` (GitHub Desktop: *Fetch origin → Pull*).
2. **Make a branch** named after the change: `git checkout -b alex/returns-chart`.
3. **Ask your AI tool for the change**, e.g. *"In src/pages/Returns.jsx add a bar chart of returns by reason code."*
   Then **check it yourself**: run `npm run dev`, click through the feature, make sure the numbers make sense.
4. **Commit and push** the branch, then open a **Pull Request** on GitHub. Write in plain words what changed.
5. GitHub runs the checks (build + math tests). When they're green and a teammate has looked, **Merge**.
   The site updates about a minute later.

Keep PRs small (one feature each) — they're easier to review and less likely to collide with someone else's work.
If two people edit the same file, GitHub will ask whoever merges second to resolve a conflict; your AI tool can help:
*"Resolve the merge conflicts in this branch, keeping both changes."*

## Database changes (be careful — one shared database)

The website code deploys automatically, but **SQL does not**. If a change touches `supabase/*.sql`:

* `02_logic.sql` (business functions): safe to re-run any time — paste the whole file into Supabase **SQL Editor** and Run.
  Do this when the PR is merged and tell the team.
* `01_schema.sql` (tables): re-running it **erases all data** (then run 02, 03 and `select load_seed();`). Only do this
  deliberately, together, e.g. before a demo.
* `03_seed.sql` is generated — change `scripts/build_seed.py` or the Excel workbook, then run `npm run seed`.

Only Riley (Supabase project owner) can open the SQL editor unless Riley invites teammates to the Supabase project
(Supabase → Organization → Team → Invite) — recommended so no one waits on one person.

## Who owns what (fill in)

| Capability | Owner | Presents in demo |
|---|---|---|
| 1 POS, 3 Barcodes | | |
| 2 Inventory | | |
| 4 Sales orders, 11 Customer portal | | |
| 5 Returns & exchanges | | |
| 6 Production orders | Riley | Riley |
| 7 Purchasing & suppliers | Riley | Riley |
| 8 MRP | | |
| 9 Financials, 10 Reports | | |
| 12 Multi-user, Wow factor | | |

## Testing (optional, for people with PostgreSQL installed)

`npm test` rebuilds a throwaway local database and runs 58 transaction checks plus the MRP slide examples.
Without PostgreSQL, `npm run test:calc` still runs the MRP/ROP/EOQ checks (the same ones GitHub runs on every PR).
