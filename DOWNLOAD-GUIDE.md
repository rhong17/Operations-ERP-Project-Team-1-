# Textiles Move ERP — Source code

Complete source from published version 2, commit
396f2294e202173a776902ca52fd214add75be1b.

## Start here
- worker/index.html — interface, styles and browser interactions
- worker/domain.mjs — ERP operations, seed data and calculations
- worker/server.mjs — API, authentication, roles and persistence
- worker/index.js — generated single-file hosting Worker
- drizzle/0000_erp.sql — database schema
- scripts/test.mjs — transaction, authorization and rendering tests
- scripts/build.mjs and scripts/build.sh — build scripts
- README.md — operating instructions and assumptions

## Build and check
Install Node.js 24 or later. No npm dependencies are required by these scripts.
From the extracted textiles-move-erp directory:

    node scripts/test.mjs
    node scripts/build.mjs

On macOS, Linux or Windows with Git Bash/WSL, build the hosting artifact:

    npm run build
    npm run validate

The deployable Worker is dist/server/index.js.

## Hosting requirements
This is a server-backed app, not a standalone HTML page. It requires a
Cloudflare Workers-compatible runtime and D1 database binding named DB.
Apply drizzle/0000_erp.sql through the host's migration process before use.
The included .openai/hosting.json identifies the existing ChatGPT Site;
a new deployment needs its own project and database configuration.

ChatGPT Sites supplies trusted authenticated identity headers, authentication
routes and site-level access restrictions. To use another host, replace that
integration with real authentication and strip client-supplied identity
headers at the trusted boundary. Arbitrary incoming identity headers must
not be trusted.

The first authenticated visitor initializes a new database and becomes its
application owner. Initialize under your own account. Two existing teammates'
emails are included in server.mjs as initial staff defaults; review those
defaults before reusing the application elsewhere.

## Data
The archive includes the sample-data generator, not the live database.
Export current records in the live app via Settings & data → Download data
backup. The source archive does not include production database credentials.

PO sending opens an email draft; no automatic email or payment provider is
configured. Review the demo limitations and accounting conventions in README.md.

Live site: https://textiles-move-erp.ces-chatgpt-2736.chatgpt.site
