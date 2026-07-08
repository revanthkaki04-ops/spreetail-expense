# Spreetail Shared Expenses App

A full-stack, responsive web application for managing shared expenses, built with a custom Node.js/Express backend and an optimized SQLite database. This application features a highly secure, XSS-fortified "Fintech" UI and a robust CSV Data Import Pipeline.

## 🚀 Key Engineering Features

1. **Greedy Debt Simplification Algorithm:** 
   Implements an optimized algorithm to minimize the total number of transactions required to settle debts among group members. Instead of everyone paying each other back incrementally, the system calculates the most efficient payment graph (e.g., if A owes B $10 and B owes C $10, A simply pays C $10).
2. **Robust CSV Import Pipeline:**
   Instead of using bloated third-party NPM packages, this app features a custom-built CSV parser. It safely detects anomalies (duplicate records, missing members, malformed data) and routes them to an interactive UI where the user can resolve the conflicts before committing to the database.
3. **Enterprise-Grade Security:**
   The frontend is rigorously protected against Cross-Site Scripting (XSS) attacks. All user-generated content and uploaded spreadsheet data is sanitized via a custom HTML escape utility before being rendered in the DOM.
4. **Responsive "Fintech" UI:**
   A sleek, mobile-first design system utilizing modern typography, glassmorphism, and micro-interactions.

---

## 📊 How to use the CSV Importer

The application allows users to quickly bulk-import historical expenses via CSV. 

### Supported CSV Format
Your CSV file must include headers and follow this general structure. The parser is highly resilient and will flag any malformed rows for manual review in the UI.

```csv
date,description,paid_by,amount,currency,split_type,split_with,split_details,notes
2026-07-01,Groceries,rohan,150.00,INR,equal,,,Weekly groceries
2026-07-03,Internet Bill,aisha,60.00,USD,percentage,aisha;rohan,aisha 40%;rohan 60%,
2026-07-05,Dinner Out,raj,3000.00,INR,share,raj;aisha;rohan,raj 2;aisha 1;rohan 1,
```

### Split Types Explained:
- `equal`: The total amount is split evenly among all active flatmates.
- `percentage`: Specify exact percentages for specific users in `split_details`.
- `share`: Specify weighted shares in `split_details` (e.g. `rohan 2; aisha 1`).
- `unequal`: Specify exact currency amounts for each user in `split_details`.
- `settlement`: Used when one user is paying back another user directly.

---

## 🛠️ Local Development Setup

To run this application locally on your machine:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd streep
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   node server.js
   ```
   *The SQLite database (`database.sqlite`) will automatically initialize and seed with default tables.*

4. **View the app:**
   Open `http://localhost:3000` in your browser.

---

## ☁️ Deployment Notes

This repository includes a `vercel.json` configuration file, allowing it to be instantly deployed as Vercel Serverless Functions. 

> **Warning regarding SQLite on Vercel:** Because Vercel Serverless Functions have an ephemeral filesystem, the local `database.sqlite` file will be reset to its initial state whenever the function sleeps. For persistent production data, it is recommended to migrate the SQLite database to a persistent volume (e.g., Render, Railway) or switch the database driver to PostgreSQL.
