import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_PATH = path.join(__dirname, 'expenses_export.csv');
const PORT = 3001; // Test port

console.log('--- Shared Expenses App: Automated Integration Tests ---');

// 1. Start the server on the test port
process.env.PORT = PORT;
const serverProcess = spawn('node', ['server.js'], {
  env: { ...process.env, PORT },
  stdio: 'pipe'
});

// Helper to wait for server start
const waitForServer = () => new Promise((resolve) => {
  serverProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[Server]: ${text.trim()}`);
    if (text.includes('Server running') || text.includes('Database initialized')) {
      resolve();
    }
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error]: ${data.toString().trim()}`);
  });
});

// Sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTests() {
  try {
    await waitForServer();
    await sleep(1000); // extra breathing room

    // Verify CSV exists
    if (!fs.existsSync(CSV_PATH)) {
      throw new Error(`Test file not found: ${CSV_PATH}`);
    }

    console.log('Logging in to get JWT authentication token...');
    const loginRes = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'aisha@flat.com', password: 'password123' })
    });
    if (!loginRes.ok) {
      throw new Error(`Login failed during test setup: ${loginRes.statusText}`);
    }
    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('Successfully logged in! Token retrieved.');

    console.log('\nStep 0: Clearing existing group expenses for test idempotence...');
    const clearRes = await fetch(`http://localhost:${PORT}/api/groups/1/clear`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!clearRes.ok) {
      throw new Error('Failed to clear database before starting test.');
    }

    console.log('\nStep 1: Uploading CSV for Anomaly Analysis...');
    
    // Read file and package into FormData
    const csvContent = fs.readFileSync(CSV_PATH);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const formData = new FormData();
    formData.append('file', blob, 'expenses_export.csv');
    formData.append('groupId', '1');

    const previewRes = await fetch(`http://localhost:${PORT}/api/import-preview`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (!previewRes.ok) {
      const err = await previewRes.json();
      throw new Error(`Anomaly preview failed: ${JSON.stringify(err)}`);
    }

    const previewData = await previewRes.json();
    const rows = previewData.rows;

    console.log(`Successfully parsed ${rows.length} rows.`);

    // --- Assertions for Anomalies ---
    console.log('\nStep 2: Checking Anomaly Detections...');
    
    // Anomaly 1: Duplicate entries (Marina Bites Row 5 and 6)
    const row5 = rows.find(r => r.csvLine === 5);
    const row6 = rows.find(r => r.csvLine === 6);
    if (!row6.anomalies.some(a => a.type === 'DUPLICATE_ENTRY')) {
      throw new Error('FAILED to detect DUPLICATE_ENTRY on Row 6');
    }
    console.log('✓ Detected Duplicate Entry (Row 6)');

    // Anomaly 2: Inconsistent names (Priya S vs Priya, lowercase priya)
    const row9 = rows.find(r => r.csvLine === 9);
    const row11 = rows.find(r => r.csvLine === 11);
    if (row9.proposed.paid_by !== 'priya' || row11.proposed.paid_by !== 'priya') {
      throw new Error('FAILED to normalize inconstitent payer name');
    }
    console.log('✓ Normalized Inconsistent Payer Names (Row 9, Row 11)');

    // Anomaly 3: Missing Payer (Row 13)
    const row13 = rows.find(r => r.csvLine === 13);
    if (!row13.anomalies.some(a => a.type === 'MISSING_PAYER')) {
      throw new Error('FAILED to detect MISSING_PAYER on Row 13');
    }
    console.log('✓ Detected Missing Payer (Row 13)');

    // Anomaly 4: Settlement Logged as Expense (Row 14)
    const row14 = rows.find(r => r.csvLine === 14);
    if (!row14.anomalies.some(a => a.type === 'SETTLEMENT_EXPENSE') || row14.proposed.is_settlement !== 1) {
      throw new Error('FAILED to detect SETTLEMENT_EXPENSE on Row 14');
    }
    console.log('✓ Detected Settlement Logged as Expense (Row 14)');

    // Anomaly 5: Invalid Percentage split (Row 15)
    const row15 = rows.find(r => r.csvLine === 15);
    if (!row15.anomalies.some(a => a.type === 'INVALID_PERCENTAGE')) {
      throw new Error('FAILED to detect INVALID_PERCENTAGE split on Row 15');
    }
    console.log('✓ Detected Invalid Percentage Sum (Row 15)');

    // Anomaly 6: Foreign Currency (USD, Row 20)
    const row20 = rows.find(r => r.csvLine === 20);
    if (!row20.anomalies.some(a => a.type === 'FOREIGN_CURRENCY') || row20.proposed.amount !== 540 * 83.0) {
      throw new Error('FAILED to detect/convert FOREIGN_CURRENCY USD to INR on Row 20');
    }
    console.log('✓ Detected and Converted Foreign Currency USD to INR (Row 20)');

    // Anomaly 7: Extraneous Member (Kabir in Row 23)
    const row23 = rows.find(r => r.csvLine === 23);
    if (!row23.anomalies.some(a => a.type === 'EXTRANEOUS_MEMBER')) {
      throw new Error('FAILED to detect EXTRANEOUS_MEMBER on Row 23');
    }
    console.log('✓ Detected Extraneous Member (Dev\'s friend Kabir, Row 23)');

    // Anomaly 8: Negative amount (Refund, Row 26)
    const row26 = rows.find(r => r.csvLine === 26);
    if (!row26.anomalies.some(a => a.type === 'NEGATIVE_AMOUNT')) {
      throw new Error('FAILED to detect NEGATIVE_AMOUNT on Row 26');
    }
    console.log('✓ Detected Negative Amount/Refund (Row 26)');

    // Anomaly 9: Out of bounds date year (Row 27)
    const row27 = rows.find(r => r.csvLine === 27);
    if (!row27.anomalies.some(a => a.type === 'TYPO_YEAR') || row27.proposed.date !== '2026-03-12') {
      throw new Error('FAILED to detect TYPO_YEAR or correct date on Row 27');
    }
    console.log('✓ Detected and Corrected Out-of-bounds Year (Row 27)');

    // Anomaly 10: Missing currency (Row 28)
    const row28 = rows.find(r => r.csvLine === 28);
    if (!row28.anomalies.some(a => a.type === 'MISSING_CURRENCY') || row28.proposed.currency !== 'INR') {
      throw new Error('FAILED to detect MISSING_CURRENCY or default to INR on Row 28');
    }
    console.log('✓ Detected Missing Currency and Defaulted to INR (Row 28)');

    // Anomaly 11: Zero Amount (Row 31)
    const row31 = rows.find(r => r.csvLine === 31);
    if (!row31.anomalies.some(a => a.type === 'ZERO_AMOUNT') || row31.proposed.import !== false) {
      throw new Error('FAILED to detect ZERO_AMOUNT or set skip on Row 31');
    }
    console.log('✓ Detected Zero Amount and set to skip by default (Row 31)');

    // Anomaly 12: Inactive Member charged (Row 36 - Meera charged after leaving)
    const row36 = rows.find(r => r.csvLine === 36);
    if (!row36.anomalies.some(a => a.type === 'INACTIVE_MEMBER')) {
      throw new Error('FAILED to detect INACTIVE_MEMBER Meera on Row 36');
    }
    console.log('✓ Detected Inactive Member Charged in Split (Row 36)');

    // Anomaly 13: Redundant split details for equal split (Row 42)
    const row42 = rows.find(r => r.csvLine === 42);
    if (!row42.anomalies.some(a => a.type === 'REDUNDANT_DETAILS')) {
      throw new Error('FAILED to detect REDUNDANT_DETAILS on Row 42');
    }
    console.log('✓ Detected Redundant Split Details for Equal Split (Row 42)');

    // Anomaly 14: Ambiguous Date (Row 34 - Deep cleaning)
    const row34 = rows.find(r => r.csvLine === 34);
    if (!row34.anomalies.some(a => a.type === 'AMBIGUOUS_DATE') || row34.proposed.date !== '2026-04-05') {
      throw new Error('FAILED to detect AMBIGUOUS_DATE or correct to 2026-04-05 on Row 34');
    }
    console.log('✓ Detected and Corrected Ambiguous Date Format (Row 34)');


    // --- Confirm Import ---
    console.log('\nStep 3: Simulating Import Confirmation...');
    
    // Resolve missing values for import:
    // Row 13 has missing payer. Let's manually set paid_by to 'aisha' as a correction
    const r13 = rows.find(r => r.csvLine === 13);
    r13.proposed.paid_by = 'aisha';
    r13.proposed.import = true;

    // We will submit the resolved rows
    const payloadRows = rows.map(r => r.proposed);

    const importRes = await fetch(`http://localhost:${PORT}/api/import-confirm`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId: 1,
        exchangeRate: 83.0,
        rows: payloadRows
      })
    });

    if (!importRes.ok) {
      const err = await importRes.json();
      throw new Error(`Import confirmation failed: ${JSON.stringify(err)}`);
    }

    const importData = await importRes.json();
    console.log(`✓ Import executed! Ingested: ${importData.importedCount}, Skipped: ${importData.skippedCount}`);

    // --- Verify Balances ---
    console.log('\nStep 4: Verifying Final Balances & Debts...');
    const balancesRes = await fetch(`http://localhost:${PORT}/api/groups/1/balances`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const balanceData = await balancesRes.json();

    console.log('Flatmate Balances Computed:');
    balanceData.balances.forEach(b => {
      console.log(` - ${b.name}: Paid = ₹${b.paid.toFixed(2)}, Owed = ₹${b.owed.toFixed(2)}, Net = ₹${b.balance.toFixed(2)}`);
    });

    console.log('\nDebt Settlement Plan (Who pays whom):');
    balanceData.settlements.forEach(s => {
      console.log(` - ${s.fromName} pays ${s.toName} : ₹${s.amount.toFixed(2)}`);
    });

    // Make sure we have no major balance rounding error (Sum of all balances must be 0)
    const sumBalances = balanceData.balances.reduce((sum, b) => sum + b.balance, 0);
    console.log(`\nSum of all balances (should be 0): ${sumBalances.toFixed(4)}`);
    if (Math.abs(sumBalances) > 0.05) {
      throw new Error(`Mathematical inconsistency: Sum of net balances is non-zero: ${sumBalances}`);
    }
    console.log('✓ Net balance sum is mathematically zero.');

    console.log('\nALL TESTS PASSED SUCCESSFULLY! (100% Correct)');
  } catch (err) {
    console.error('\nTEST FAILURE:', err);
    process.exit(1);
  } finally {
    // Kill the server process
    serverProcess.kill();
  }
}

runTests();
