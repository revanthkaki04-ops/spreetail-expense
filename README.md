# Spreetail Shared Expenses App

A modern, high-performance shared expenses application designed to ingest and parse a messy flat expense export (`expenses_export.csv`), interactively resolve data anomalies (at least 14 categories detected), track group memberships over time, compute precise balances, and simplify debt settlements.

## Key Features

1. **User Authentication**: Secure Login & Registration module using JSON Web Tokens (JWT) and bcrypt password hashing. Access default profiles (Aisha, Rohan, Priya, Meera, Sam, Dev) using email `<name>@flat.com` (e.g. `aisha@flat.com`) and password `password123`.
2. **Membership Timeline Manager**: Enforce start and end dates for group members. This ensures Sam is not billed for March utilities and Meera is not charged after she moves out.
3. **Advanced CSV Importer**: Pre-scan the export file, highlight anomalies (duplicates, typos, out-of-bound dates, multi-currency, missing payers), and offer a GUI to review, correct, or skip rows.
4. **Transparent Ledger**: Rohan's "No Magic Numbers" view showing every item contributing to a user's balance.
5. **Optimized Debt Settlement**: Aisha's "Who Pays Whom" view using a transaction minimization algorithm.
6. **Relational Database**: Stored in a local, self-contained SQLite database.

---

## Setup & Running Instructions

### Prerequisites
- Node.js (v18.0.0 or higher recommended, tested on v24.16.0)
- npm (v9.0.0 or higher recommended)

### 1. Install Dependencies
In the root directory, run:
```bash
npm install
```

### 2. Start the Application
Run the local dev server:
```bash
npm start
```
The server will initialize a local `database.db` and start listening on [http://localhost:3000](http://localhost:3000).

### 3. Running Automated Tests
To run the automated integration tests which assert the correctness of all 14 anomaly checks and balance math:
```bash
npm test
```

---

## Technical Stack & Architecture

- **Backend**: Node.js, Express, SQLite (`sqlite3`).
- **Frontend**: Single-Page Application (SPA) built using Vanilla HTML5, CSS3 Custom Properties (variables), and Vanilla JS ES Modules.
- **Styling**: Sleek glassmorphism style, custom color coding for debts/credits, fully responsive layout, and transitions.

---

## AI Collaboration & Attribution
This project was co-authored with **Antigravity**, a coding assistant designed by Google DeepMind. Details of the AI's contributions, prompts, and corrections can be reviewed in [AI_USAGE.md](file:///c:/Users/Revanth/Desktop/streep/AI_USAGE.md).
