# Connectivo FinOps — Cloudflare Workers deployment package (v2)

This replaces the earlier "Cloudflare Pages" package. Cloudflare has put
Pages into maintenance mode and now directs new full-stack sites to
**Workers with static assets** instead — which is what you actually got
when you went through the dashboard (the `.workers.dev` domain was the
giveaway). A plain Worker doesn't do Pages' automatic file-based routing,
so this version is one Worker script that routes `/api/*` itself and
serves everything else as a static file.

This whole thing has been function-tested end-to-end in a simulated
environment before being handed to you — login, sessions, every database
operation, access control, file upload/download, and logout all verified
to behave correctly, not just checked for syntax.

## What's in here

```
public/index.html        the whole frontend (one file, as before)
src/worker.js             the ONE Worker script — routes /api/*, serves index.html otherwise
lib/
  auth.js                 credential table, password check, session signing (unchanged from before)
  store.js                Cloudflare KV helper (unchanged from before)
wrangler.toml              config — already has your real KV namespace ID filled in
scripts/hash-password.cjs   run this to generate a new password's hash
```

## Why the CLI this time, not the dashboard

The last two rounds of trouble both came from dashboard flows: drag-and-
drop silently skipping functions, and "Workers & Pages → Create" landing
you in a different product than expected. `wrangler.toml` above is
already fully configured — including your real KV namespace ID — so the
CLI deploy is one command with nothing left to click through or get
wrong. You'll need [Node.js](https://nodejs.org) installed (the LTS
installer, if you don't have it already — same requirement as before).

## One-time setup

Open a terminal in this folder and run:

```bash
npx wrangler login
```

This opens your browser to authorize Wrangler against your Cloudflare
account. Then set the four secrets — each command will prompt you to
paste the value (nothing is typed directly into the command, so it won't
end up in your shell history):

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put AUTH_SHANTO_HASH
npx wrangler secret put AUTH_SHOMVOB_HASH
npx wrangler secret put AUTH_SHOIKOT_HASH
```

Paste these exact values when prompted (same accounts as before — Shanto/
Eminem02, Shomvob/Connectivoceo2026, Shoikot/Connectivoadm2026):

- `SESSION_SECRET`: any long random string — `openssl rand -hex 32`, or mash the keyboard for 40+ characters
- `AUTH_SHANTO_HASH`: `100000:a72c08b9e5f18f32d823aa1dfcd53f19:7b7c6643933b9ef8de5a7009150455ec5813d7a528d4d784201024da96e9bec8`
- `AUTH_SHOMVOB_HASH`: `100000:c1beed829b76768d77fb7e797ce8447c:e9a9871600a9b8bd67836a0b20d57a1822a4d6c67fe7ec1108f2fecb4b0c5045`
- `AUTH_SHOIKOT_HASH`: `100000:11f55580d6c3a33d5767c31f3b952a79:af3a5be7cdc0d7d7dc2b77e28527bec816c64cd965883e4489fde6984fc656b7`

**If you already set the earlier `210000:...` values from a prior version
of this package, you must overwrite them with these** — those will never
work. Cloudflare's `crypto.subtle` hard-caps PBKDF2 at 100,000 iterations;
210,000 throws `NotSupportedError` on every single login attempt,
regardless of whether the password typed is correct. This was the actual
root cause of every "Incorrect username or password" error in earlier
rounds of setting this up — not a typo, not a corrupted paste, not a
Windows terminal issue. (A separate frontend bug was also mislabeling
that specific server error as a wrong-password message, which is exactly
why it looked like a credentials problem for so long — also fixed now.)

## Deploy

```bash
npx wrangler deploy
```

That's it — one command uploads the Worker, the static site, and wires up
the KV binding, all from what's already in `wrangler.toml`. It'll print
your live URL when it finishes (a `*.workers.dev` address, or a custom
domain if you've attached one to this Worker).

## Redeploying after a code change

Just run `npx wrangler deploy` again. Secrets you've already set stay in
place — you only need `wrangler secret put` again if you're changing one.

## How to tell it's actually working

Open the URL wrangler printed. The login screen should say *"Your
password is checked on Connectivo's own server and never stored in this
page."* Sign in as Shanto, open Developer Console — **Runtime Mode**
should say **"Live server backend."**

## Changing a password later

```bash
node scripts/hash-password.cjs "TheNewPassword"
```

Copy the full `iterations:salt:hash` string, then:

```bash
npx wrangler secret put AUTH_SHANTO_HASH   # or whichever account
npx wrangler deploy
```

## What's genuinely secure, same as before

- Passwords checked server-side (PBKDF2-SHA256, 100,000 iterations — Cloudflare's actual maximum, via
  the standard Web Crypto API), never sent to or stored in the browser page.
- Sessions: an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, HMAC-signed
  so it can't be forged without `SESSION_SECRET`.
- Every data read and write is rejected server-side without a valid
  session — verified directly in testing, not just assumed from the code.
- Hard delete is restricted to the developer account, enforced in the
  Worker itself.

## Honest limits

- Cloudflare KV is eventually consistent — a write can rarely take a few
  seconds (up to ~60s in the worst case) to show up from a different
  location. Usually much faster in practice.
- `SESSION_SECRET` and the three `AUTH_*_HASH` values are only as safe as
  your Cloudflare account's own login.
- No rate-limiting on login attempts and no 2FA in this version.
- One KV namespace holds everything, including file attachments (capped
  at 4 MB each) as base64. Fine at small-business scale; Cloudflare R2
  (object storage) would be the natural upgrade if attachments grow large.
- If you'd still rather connect this repo to Cloudflare via Git for
  automatic redeploys on push (instead of running `wrangler deploy` by
  hand each time), that's "Workers Builds" in the dashboard — newer and
  less polished than Pages' old Git integration was, which is part of why
  the CLI is the more predictable choice for now.

## Invoice Portal (new)
Open it from the FinOps menu: **Invoice Portal** (CEO / Developer / Admin). It lives at `/invoice/`, its API at `/invoice-api/*`, data under the `inv:` KV keys. It is completely separate from the ledger.
- Email sending reuses the Payroll/Attendance Portal email setup (Payroll/Attendance Portal > Settings > Email delivery).
- PDFs are built in the browser on the company pad (`public/salary-assets/pad.jpg`).

### Invoice Portal v2 (audit release)
Fixes: invoice number no longer changes when a saved invoice's date is edited; new invoices no longer show "unsaved" or block leaving until touched; built-in dialogs replaced by in-app dialogs; live preview now drawn with a bundled PDF renderer (`public/salary-assets/pdfjs/`) so it works on phones and every browser; mobile list/bottom navigation fixed. New: dashboard chart/status mix/top clients, status tabs with counts, Mark as paid, payment reminder emails.
Mobile release: line-item and amount fields re-laid out (no clipped fields), service dropdown verified, app-style mobile UI (bottom tabs, floating New invoice button, sticky Save bar, bottom-sheet dialogs and menus, 16px inputs, 40px+ touch targets).
Client profiles: click any client (Clients page) to open a full profile - details, notes, account summary per currency, all invoices, payment history, emails sent - and export it as a PDF on the company pad.
Payment receipts: on an invoice Payments tab, attach screenshots/bank slips/PDFs to each payment as a receipt (stored in KV under inv:file:*, images compressed in the browser).
Documents tab: month-wise folders of all payment receipts across invoices, with search, client filter, view and download.

## Latest changes (Payroll/Attendance portal, invoice PDF)
- The Salary portal is now called **Payroll/Attendance Portal** (the sign-in screen says "Payroll Portal").
- New side tabs **Overtime, Leave/Absent, Late, WFH**: each lists all employees with totals for the chosen period; click an employee for the day-by-day details calculated from the attendance sheet. The top panel filters by period (this month, last month, last 3 months, this year, all time, or custom dates). PDF (company pad) and Excel export work for both the list and one employee.
- **Salary Sheet** screen redesigned (summary cards, grouped sortable table, search/department filter, "Official sheet preview" tab). CSV, Excel, PDF and Print exports keep the original official layout.
- Invoice PDF: Notes & Terms removed; the Payment Details box takes its place beside the signature; "Amount due (in words)" is one horizontal line under the Amount Due box and moves down as services are added; bank details gain "Routing Number: 225260991" between Branch Name and SWIFT (added automatically to existing City Bank accounts).
- Overtime / Leave / Late / WFH PDFs are now premium reports drawn on the company pad (A4, title block, details card, summary tiles, styled table, signature lines). The Salary Sheet no longer prints the extra "Month, Year" line below "For The Month Of ...".
- A 2-second animated Connectivo logo screen appears when you switch between FinOps, Payroll/Attendance Portal and Invoice Portal.
- Employee profile: a read-only **Net salary** box (Gross + Communication + Mobile bill) sits beside Mobile bill and updates as you type.
- Overtime / Leave / Late / WFH PDFs: only "Authorised Signatory" remains, with the Admin & HR signature image from Settings, title "Admin & HR" and name "A K Fazlul Haque".
- FinOps now has a dark mode (moon/sun button in the top bar). The choice is remembered and is shared with the Payroll/Attendance and Invoice portals.
- Dark mode: hover/focus colours fixed (no more white flashes on table rows, icon buttons, cards, inputs). Login now shows the 2-second Connectivo splash after the password is accepted, then opens the portal.
- Shift Schedule, Overtime, Leave/Absent, Late and WFH list pages have a **View** switch (Boxes / List) at the top right; the choice is remembered.
- Attendance sheet / Daily entry: hold the dotted handle at the left of a shift row and drag it up or down (also onto another day in the sheet); press Save changes to keep the new order/day. Click the handle, press Ctrl+C to copy the shift, then open Add Record and press Ctrl+V to fill the dialog with it.
- Every agent has their own colour (set in the employee profile / Add Employee dialog; the portal blocks a colour that another active agent already uses). Existing agents get distinct colours automatically the first time an admin opens the portal.

## Leave deduction is now hourly
Each leave record is charged by its shift length: shift hours x hourly rate (gross / working hours). A 6-hour shift leave costs less than an 8-hour one. If the shift has no times, the default working hours per day are used.

## Employment History (employee profile)
New card on each employee profile: summary tiles (working since + tenure as of today, current position, last promotion, last increment) and a table of events (Appointment, Confirmation, Increment, Promotion, Transfer, Salary Revision, Warning, Resignation, Termination, Other) with date, time since, new gross and a View/Download link to the attached document. Documents can be picked from the employee's Documents or uploaded right in the Add event dialog. Saved inside the employee record (`hist`).

## Employment History is now a folder (Employees > Employment History)
- Folder page: every employee in one list, with component buttons on top (Overview, Appointment, Confirmation, Increment, Promotion, Transfer, Salary Revision, Show-cause, Warning, Resignation, Termination, Other). Overview shows service length, confirmation, increments count, last increment/promotion, show-cause and warning counts. A component button shows 1st/2nd/3rd... entries for everyone with dates, how long ago and a "Proof" link to the document.
- Click a name for that employee's Employment History profile (tiles, filterable service record, Add/Edit/Delete events, documents). The employee profile has a shortcut to it.
- New event type: Show-cause.

## Round "C" favicon, FinOps logo, Employment History export
- Browser-tab icon (all three portals) is now a round icon showing only the logo's "C" (files `public/salary-assets/favicon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`). The FinOps sidebar logo uses the clean C mark (`c-mark.png`).
- Employment History folder and each employee's history page have PDF and Excel export. PDFs are printed on the company pad with the Admin & HR signature. The folder export follows the selected component button and search.
- "Proof" buttons are now labelled "Document".

## Premium employee information PDF
The employee "Download info PDF" is redesigned on the company pad: gradient profile card with photo, key tiles (working since, time with company, gross, net, increments), contact and salary cards with a Net Salary bar, bank card, latest employment-history events, documents, notes and the Admin & HR signature.

## Premium employee list PDFs
The Employees and Ex-employees PDF exports now use the same premium company-pad layout (summary card, tiles, styled table, Admin & HR signature). Excel export is unchanged in purpose.

## Landscape company pad
Added `public/salary-assets/pad-landscape.jpg` (same header, watermark C and footer contacts, re-laid out for A4 landscape). The Employees, Ex-employees and Employment History (folder) PDFs now print landscape on it. Per-employee PDFs stay portrait on the normal pad.

## Extra shifts count fully as overtime
A shift scheduled with Type = Extra now counts all its worked hours (IN to OUT) as overtime, with no late or less-time deduction, and flows into the Overtime tab, the payslip Over Time line (basic hourly x multiplier, subject to admin approval) and the reports. It needs clock IN/OUT like any other shift.

## Projects (project-wise finance)
- FinOps sidebar -> **Projects** opens a separate portal at `/projects/` (API `/projects-api/*`, data in KV key `prj:db`, receipts in `prj:file:*`). Only ceo / developer / admin can open it.
- Its numbers are completely separate from the FinOps central accounts: nothing entered here changes FinOps totals and vice versa.
- Add projects (client, contract value, cost budget, dates, status), then record Income / Expenditure / Transfers per project with receipts attached. Each project page shows received, spent, net profit, budget used, contract collected.
- Reports (all PDF on the company pad + CSV): Financial Summary, Profit & Loss, Journal, Cash Flow Statement, Cash & Bank Book, Income / Expenditure / Historical Analysis, and a per-project Statement PDF. Every report can be filtered by one project or all, and by date range.
- Signatory defaults to the Admin & HR signature from the Payroll portal; can be overridden in Projects > Settings.
- No code change needed to deploy: `npx wrangler deploy` as before.
- Currency: in Projects, every transaction dialog has a Tk (BDT) / $ (USD) choice. For USD you type the dollar amount and the rate (default rate is kept in Projects > Settings); the Tk value is calculated and all totals, reports and balances use Tk. The original dollar amount and rate stay shown on the entry and in PDF/CSV exports. Domestic entries just stay in BDT.
- FinOps Cashbook PDF no longer includes the "Daily Balance - Balance B/D to Balance C/D" table (the on-screen view is unchanged).

## Projects portal v2 (same design as FinOps)
- `/projects/` is now the FinOps app itself, built from `public/index.html` by `python3 scripts/build-projects.py` (so every tab, the Cash & Bank Book layout and all PDF exports look exactly like FinOps). It uses its OWN data (`pdata:*` / `pfile:*` in KV through `/projects-api/data|upload|file`), so nothing touches the FinOps central books.
- "Business Unit" is called **Project** there. Add projects on the Projects page (client, contract value, cost budget, status, dates); every income/expenditure picks a project. Reports, Cash Book, Journal, etc. can be filtered by project, and each project has a Statement PDF.
- USD to BDT: in the Record dialog choose $ (USD), type the dollar amount and the rate; the Tk value is calculated and stored, all totals use Tk, and the dollar amount stays visible in lists/CSV.
- Data from the earlier (first-version) Projects portal is not carried over; it stays in KV under `prj:*` untouched.
- If you later change FinOps' `public/index.html`, re-run the build script to refresh the Projects copy.
- Fixes: your data from the first Projects portal is imported automatically the first time the new portal opens (projects, accounts, transactions incl. USD, receipts, project documents; nothing is deleted from the old store and it never imports twice). The Record dialog now has an Income / Expenditure / Transfer switch. Documents has an **Upload Document** button for contracts, work orders etc. (per project) besides receipts attached to transactions.

## Download data / Upload data (move to a company domain)
- Where: FinOps > System Settings (everything, or FinOps only), Payroll/Attendance Portal > Settings, Invoice Portal > Settings, Projects > Download / Upload Data. Only CEO / developer accounts can use it.
- Download saves ALL records of that portal (data, receipts/documents, settings, secrets such as the email key) into one `.json` file. Keep it private.
- To move: deploy this project on the new domain (same `npx wrangler deploy`, create its KV namespace, set the same secrets for sign-in), sign in, open the same page and **Upload data**. The file replaces the data there and everything works at once.
- The sign-in passwords and SESSION_SECRET are Cloudflare secrets, not data, so set them on the new deployment as before.
- Free Cloudflare plan allows ~1,000 KV writes/day; a very large restore can be run again the next day (it is safe to repeat).
- Late is now counted from the clock-in itself: a shift with a clock-in but no clock-out yet shows "Late ..." immediately (and counts in the late totals, Late tab and deductions), while the row stays Pending only for the missing clock-out. Rows with no clock-in at all are unchanged.

## Monthly Attendance Report (Payroll portal)
Sidebar > Tracking > "Monthly Attendance Report". Pick a month; each employee gets a one-page-or-more PDF on the company pad with four sections (Overtime, Late, Leave/Absent, WFH) built from the same attendance data as the tracking tabs. Buttons: View PDF, Download, Email. A tick-box on the page ("Attach this report when a payslip is emailed", on by default) makes every payslip email carry both PDFs (payslip + attendance report). "Email" sends the report alone (`/salary-api/attreport/send`); sent times are stored in `db.attsent`. mail.js now accepts several attachments.

## Naming, grouping, shift-hours and font update
- Bank: "City Bank PLC" is now "The City Bank PLC" everywhere (bank list, saved employees, custom banks). Old data is renamed automatically when the portal opens.
- Labels: Medical, Transport and Mobile Bill are now "Medical Allowance", "Transport Allowance" and "Mobile Bill Allowance" (profile, payslip editor, payslip PDF, salary sheet, settings). Saved payslips are renamed automatically.
- Payslip / salary sheet grouping: Gross salary components (Basic, House Rent, Medical, Transport) | Additional earnings (Over Time, Bonus, any other added line) | Allowances - not part of gross (Communication Allowance, Mobile Bill Allowance). Totals/net pay are unchanged.
- Full/half shift rule (leave and overtime): a leave day on a 8 to 9-hour shift is deducted as 8 hours, on a 3 to 4.5-hour shift as 4 hours. Overtime / extra time of 8 to 9 hours is paid as 8 hours, and 3 to 4.5 hours as 4 hours (regular overtime and Extra shifts). Other lengths are unchanged.
- Font: every PDF (all four portals) uses an embedded Century Gothic look-alike (URW Gothic, open licence); Excel files name "Century Gothic" as the font. Files: lib/salary/fontdata.js (payroll/invoice PDFs), public/salary-assets/cgfont.js (FinOps/Projects PDFs).

## Own-server (Node.js) version
`node server.mjs` runs everything without Cloudflare (see DEPLOY-NODE.txt). Data lives in ./data. A new developer login `abir` was added (starting password 12345678, change it after first login).
