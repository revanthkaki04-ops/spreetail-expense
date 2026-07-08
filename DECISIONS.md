# Decision Log (DECISIONS.md)

This log details the significant engineering and architectural decisions made during the design and construction of the Shared Expenses App, documenting options considered and why specific paths were selected.

---

## 1. Choice of Relational Database
* **Decision**: SQLite3.
* **Options Considered**:
  - **PostgreSQL / MySQL**: Robust, but require local installation and server setup. Adds unnecessary deployment overhead for a lightweight shared expenses coding assignment.
  - **In-Memory JS Objects**: Extremely fast, but lacks persistence. Relational integrity cannot be enforced at the schema level. Fails the "Use relational DBs only" requirement.
  - **SQLite3**: Lightweight, zero-configuration, persists to a single local file (`database.db`), and supports full SQL queries, JOINs, transactions, and foreign key integrity.
* **Rationale**: SQLite3 provides the structure of a fully relational SQL database with zero setup, making it easy to deploy, run, and modify during a live review session.

---

## 2. Frontend Framework & Tech Stack
* **Decision**: Vanilla HTML5, Vanilla CSS3, and ES6 Javascript Modules (No Build Step).
* **Options Considered**:
  - **Next.js / React (Vite)**: Excellent component modularity and ecosystem. However, they introduce a build step (`npm run build`), dependency bloat, and slower hot-reloading loops during live code modifications.
  - **Vanilla JS + Express Static Serving**: Super lightweight, loads instantly, zero build overhead, and is extremely easy to modify and test in real-time.
* **Rationale**: During live 45-minute technical interviews, any build errors, package mismatches, or bundle caching can derail changes. A pure vanilla frontend served directly by Express provides a robust environment where edits can be verified by hitting "Refresh" in the browser.

---

## 3. Database Schema for Expense Splits
* **Decision**: Pre-calculated Split Table (`expense_splits.owed_amount` stored in INR).
* **Options Considered**:
  - **Calculate Splits Dynamically on Query**: Query the expense details (e.g., parsing percentages or shares) on every page render and compute owed amounts on-the-fly.
  - **Pre-calculate and Store Shares**: Compute individual split amounts during CSV import or manual logging, then store each participant's exact owed share in a dedicated `expense_splits` table.
* **Rationale**: Pre-calculating splits during ingestion makes reading ledger balances and computing individual transactions incredibly fast. A simple `SUM(amount)` and `SUM(owed_amount)` query returns balances instantly without parsing string fields (`split_details`) in SQL. It also simplifies the implementation of Rohan's ledger breakdown.

---

## 4. Handling Kabir's Share (Dev's Friend)
* **Decision**: Reallocate Kabir's share to Dev (the flatmate who brought him).
* **Options Considered**:
  - **Option A**: Treat Kabir as a full flatmate and calculate balances for him (Kabir would owe money, but who would collect it?).
  - **Option B**: Block the import or fail on Row 23 because Kabir is not a flatmate.
  - **Option C**: Reallocate Kabir's portion of the bill to Dev, increasing Dev's personal split amount.
* **Rationale**: Option C represents real-world behavior for temporary guests. Since Dev brought Kabir, Dev is responsible for covering Kabir's share. This is resolved cleanly during split calculations, adding Kabir's 1/5 split to Dev's split.

---

## 5. Timeline-Based Group Memberships
* **Decision**: Schema-enforced membership timeline dates (`joined_at`, `left_at`).
* **Options Considered**:
  - **Hardcoded Date Logic in Code**: Add conditional dates in JS code checking when Sam or Meera joined. (Brittle, hard to update).
  - **Membership Table with Active Dates**: Store active timelines in a relational table, dynamically filtering participants when splits are calculated.
* **Rationale**: Enforcing dates in the database enables dynamic changes. If a member's moving date is modified in the UI, all balances are instantly recalculated correctly. This resolves Sam's concern (March electricity) and Meera's concern (April groceries) dynamically.
