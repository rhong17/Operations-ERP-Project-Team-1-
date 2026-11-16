# One-time setup (Riley does this once, about 20 minutes)

After this, every teammate opens the site with a normal email login, and every
merge to `main` publishes automatically. No one person has to "republish".

```
GitHub repo ──push to main──▶ GitHub Actions ──builds──▶ GitHub Pages (the website)
                                                              │
                                     everyone's browser ◀─────┘
                                              │  logins, data, live updates
                                              ▼
                                     Supabase (database + auth)
```

## 1. Create the database (Supabase, free)

1. Go to https://supabase.com, sign in (GitHub login is easiest) and click **New project**.
   Name it `textiles-move-erp`, choose a region (e.g. *East US*), set a database password and save it somewhere safe.
2. When the project is ready, open **SQL Editor → New query** and run these files **in order**
   (open each file on GitHub or in your editor, copy everything, paste, click **Run**):
   1. `supabase/01_schema.sql`
   2. `supabase/02_logic.sql`
   3. `supabase/03_seed.sql`
   4. then run this one line: `select load_seed();`
3. **Change the team code** (the code that makes a new sign-up a staff user). In the SQL editor run:
   ```sql
   update team_config set team_code = 'pick-your-own-code' where id = 1;
   ```
   Share that code with teammates privately (group chat), not in the GitHub repo — the repo is public.
4. **Authentication → Sign In / Providers → Email**: turn **off** "Confirm email" so teammates and
   Dr. Wright's test customers can log in right after signing up. (Leave it on if you prefer email confirmation.)
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

## 2. Connect the app to the database

Paste the two values into `src/config.js` (replace the `PASTE_...` text), commit and push.
The anon key is meant to be public — the database's row-level security decides what each login can see and do.

## 3. Turn on the website (GitHub Pages)

1. On GitHub: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or **Actions → Build, test and deploy → Run workflow**).
3. After ~1 minute the site is at **https://rhong17.github.io/Operations-ERP-Project-Team-1-/**
   (also shown on the Actions run and under Settings → Pages).

## 4. Invite the team

* GitHub: **Settings → Collaborators → Add people** (each teammate's GitHub username) so they can push branches.
* ERP: send everyone the site link + team code. Each person clicks **Create account**, enters the team code, and is staff.
* Customers (for the demo): anyone who signs up **without** the code gets the customer portal.

## Before the demo

* Settings & Users → **Reset demo data** (type RESET) to restore the starting dataset with fresh open orders dated from that day.
* Print barcode labels: Inventory → Barcode labels → Print.
* Test a USB scanner or phone camera on the POS page. (Camera scanning needs the https GitHub Pages site, not a plain http address.)
