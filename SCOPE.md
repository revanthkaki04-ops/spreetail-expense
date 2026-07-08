# Project Scope & Anomaly Log

This document lists all the deliberate data anomalies identified in the `expenses_export.csv` file, details how each is detected and resolved, and documents the relational database schema.

---

## 1. Relational Database Schema

We use **SQLite** to persist data. The schema enforces foreign key constraints and structures the data to enable efficient ledger lookups.

### Table: `users`
Tracks flatmates and system users.
- `id` (TEXT PRIMARY KEY): Unique lowercase identifier (e.g. `aisha`, `rohan`).
- `name` (TEXT NOT NULL): Display name (e.g. `Aisha`, `Rohan`).

### Table: `groups`
Tracks different groups (e.g. "Flat Shared Expenses").
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT): Unique group ID.
- `name` (TEXT NOT NULL): Group name.

### Table: `group_memberships`
Handles changing group memberships over time.
- `group_id` (INTEGER): Reference to groups table.
- `user_id` (TEXT): Reference to users table.
- `joined_at` (TEXT NOT NULL): Joined date (YYYY-MM-DD).
- `left_at` (TEXT NULL): Left date (YYYY-MM-DD), null if currently active.
- *Primary Key*: (`group_id`, `user_id`)

### Table: `expenses`
Stores the master records of expenses.
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT): Unique expense ID.
- `group_id` (INTEGER): Reference to group.
- `description` (TEXT NOT NULL): Description of expense.
- `paid_by` (TEXT): Payer user ID.
- `amount` (REAL NOT NULL): Amount converted to INR.
- `currency` (TEXT NOT NULL): Original currency code (e.g., INR, USD).
- `original_amount` (REAL NOT NULL): Original amount in that currency.
- `exchange_rate` (REAL NOT NULL): Rate used to convert to INR.
- `split_type` (TEXT): Split type (`equal`, `share`, `percentage`, `unequal`, `settlement`).
- `date` (TEXT NOT NULL): Date of expense (YYYY-MM-DD).
- `notes` (TEXT): Additional notes.
- `is_settlement` (INTEGER DEFAULT 0): 1 if a direct payment settlement, 0 if standard expense.

### Table: `expense_splits`
Details the exact owed share (in INR) for each participant.
- `expense_id` (INTEGER): Reference to expenses table.
- `user_id` (TEXT): Reference to users table.
- `owed_amount` (REAL NOT NULL): Amount this user owes.
- *Primary Key*: (`expense_id`, `user_id`)

---

## 2. CSV Anomaly Log (14 Detected Problems)

| # | Anomaly Type | Location in CSV | Detection Mechanism | Resolution Policy |
|---|---|---|---|---|
| **1** | **Duplicate Entries** | Row 5 & 6 (Marina Bites) | Checks if date, amount, payer (normalized) are identical, and description words have $\ge$ 75% overlap. | Proposed default: **Skip duplicate** (import only Row 5). Toggleable in UI. |
| **2** | **Inconsistent Names** | Row 9 (`priya`), Row 11 (`Priya S`), Row 27 (`rohan `) | Lowercases and trims spaces. Maps variations of primary flatmates to their DB user ID. | Normalize to `priya` and `rohan` automatically on import. |
| **3** | **Missing Payer** | Row 13 (House cleaning) | Empty `paid_by` column. | Block import and request manual assignment. Select from dropdown in UI. |
| **4** | **Settlement as Expense** | Row 14 (Rohan paid Aisha) | Empty `split_type`, `split_with` is "Aisha", description contains "paid ... back". | Treat as **direct debt payment/settlement** instead of a split expense. |
| **5** | **Invalid Percentage Sum** | Row 15 & 32 (Pizza, Brunch) | `split_type` = percentage, details sum is 110% instead of 100%. | **Auto-normalize** by scaling percentages to sum to 100%. |
| **6** | **Foreign Currency** | Row 20, 21, 23, 26 (Goa USD) | `currency` column is `'USD'`. | Convert to INR. Default rate: **83.0** (user-adjustable on UI). |
| **7** | **Extraneous Member** | Row 23 (Kabir at Parasailing) | Participant in `split_with` is not in flatmates membership list. | **Reallocate Kabir's share to Dev** (the flatmate who invited him). |
| **8** | **Negative Amount** | Row 26 (Parasailing refund) | `amount` < 0 (value is `-30` USD). | Import as a refund: split negative amounts to reduce participants' owes. |
| **9** | **Out-of-bounds Year** | Row 27 (Airport cab) | Date year is `2014` during a `2026` trip. | Correct date to `2026-03-12` (aligning with end of Goa trip). |
| **10** | **Missing Currency** | Row 28 (Groceries DMart) | Empty `currency` column. | Assume **INR** and show warning badge. |
| **11** | **Zero Amount** | Row 31 (Swiggy dinner) | `amount` = 0. | Skip import by default (import as $0 record optional). |
| **12** | **Inactive Member Charged** | Row 36 (Groceries on April 2) | Split includes Meera, who moved out March 31. | Exclude Meera, split cost among active members (Aisha, Rohan, Priya). |
| **13** | **Redundant Details** | Row 42 (Common furniture) | `split_type` = equal, but details specify `Aisha 1; Rohan 1...` | Ignore details and perform standard equal split. |
| **14** | **Date Ambiguity** | Row 34 (Deep cleaning) | Date is `2026-05-04` but notes say "format is a mess, April 5 or May 4?". | Correct date to `2026-04-05` (consistent with moving-in events). |
