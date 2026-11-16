# Textiles Move ERP

A working mini-ERP for **Textiles Move**, a knitwear manufacturer in Gamarra, Lima (Peru), built for BYU's ERP project.
Real company products and barcodes; sales, inventory, production, purchasing, MRP and financials in one shared database.

**Live site:** https://rhong17.github.io/Operations-ERP-Project-Team-1-/ (after the one-time setup in `docs/SETUP.md`)

| Guide | For |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | One-time setup: Supabase database, GitHub Pages, inviting the team |
| [docs/TEAM-GUIDE.md](docs/TEAM-GUIDE.md) | How teammates make changes with AI on their own branch and publish them |
| [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) | Understanding the ERP and MRP for the demo, formulas, rehearsal checklist |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | Rules your AI coding assistant reads automatically |

## Stack
React + Vite (front end) · Supabase PostgreSQL, Auth, Realtime (database, logins, live updates) ·
PL/pgSQL transaction functions with double-entry accounting · GitHub Actions → GitHub Pages (auto-deploy) ·
built with Claude Code.

## Commands
```
npm install          # once
npm run dev          # local site at http://localhost:5173 (uses the shared Supabase database)
npm run build        # production build
npm run test:calc    # MRP / ROP / EOQ / scorecard checks (runs on every PR)
npm test             # + 58 database transaction checks (needs local PostgreSQL)
npm run seed         # regenerate supabase/03_seed.sql from the company workbook
```

The previous ChatGPT-Codex version is preserved on the `codex-version` branch.
