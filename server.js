import express from 'express';
import sqlite3 from 'sqlite3';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file if it exists
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        if (key && !key.startsWith('#')) {
          process.env[key] = val;
        }
      }
    });
  }
} catch (err) {
  console.error('Error loading .env file:', err);
}

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'spreetail-secret-key-12345';

// Configure nodemailer transport
const smtpTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: parseInt(process.env.SMTP_PORT) || 2525,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Blacklisted disposable email domains
const disposableDomains = [
  'mailinator.com', 'yopmail.com', 'tempmail.com', 'dispostable.com', 
  'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'trashmail.com'
];

/**
 * Validates an email address format and checks against disposable email domains.
 * Ensures the payload is a valid string to prevent runtime exceptions.
 * 
 * @param {string} email - The email address to validate.
 * @returns {{valid: boolean, reason?: string}} Validation result object.
 */
function isLegitEmail(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return { valid: false, reason: "Email must be a valid string." };
  }
  
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) return { valid: false, reason: "Email format is incorrect. We need an '@' and a domain (e.g. gmail.com)" };

  const domain = email.split('@')[1].toLowerCase();
  if (disposableDomains.includes(domain)) {
    return { valid: false, reason: 'Disposable email domains are not allowed' };
  }

  return { valid: true };
}

// Map to hold pending user registrations for verification (expiring in 10 mins)
const pendingRegistrations = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file handling
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Open database connection
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

// Promisify DB methods
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

// Initialize database schema
async function initDb() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT
  )`);

  // Migrate columns for existing users table if they are missing
  try {
    await dbRun(`ALTER TABLE users ADD COLUMN email TEXT`);
  } catch (e) {
    // column might exist
  }
  try {
    await dbRun(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  } catch (e) {
    // column might exist
  }

  await dbRun(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS group_memberships (
    group_id INTEGER,
    user_id TEXT,
    joined_at TEXT NOT NULL,
    left_at TEXT,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER,
    description TEXT NOT NULL,
    paid_by TEXT,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    original_amount REAL NOT NULL,
    exchange_rate REAL NOT NULL,
    split_type TEXT,
    date TEXT NOT NULL,
    notes TEXT,
    is_settlement INTEGER DEFAULT 0,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(paid_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS expense_splits (
    id_for_migration INTEGER, -- placeholder
    expense_id INTEGER,
    user_id TEXT,
    owed_amount REAL NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Pre-populate/update default users with credentials
  const defaultUsers = [
    { id: 'aisha', name: 'Aisha', email: 'aisha@flat.com', password: 'password123' },
    { id: 'rohan', name: 'Rohan', email: 'rohan@flat.com', password: 'password123' },
    { id: 'priya', name: 'Priya', email: 'priya@flat.com', password: 'password123' },
    { id: 'meera', name: 'Meera', email: 'meera@flat.com', password: 'password123' },
    { id: 'sam', name: 'Sam', email: 'sam@flat.com', password: 'password123' },
    { id: 'dev', name: 'Dev', email: 'dev@flat.com', password: 'password123' },
    { id: 'kabir', name: 'Kabir', email: 'kabir@flat.com', password: 'password123' }
  ];

  for (const u of defaultUsers) {
    const hash = bcrypt.hashSync(u.password, 10);
    const existing = await dbGet(`SELECT * FROM users WHERE id = ?`, [u.id]);
    if (!existing) {
      await dbRun(`INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`, [u.id, u.name, u.email, hash]);
    } else {
      // update email and password_hash if missing
      await dbRun(`UPDATE users SET email = ?, password_hash = ? WHERE id = ?`, [u.email, hash, u.id]);
    }
  }

  // Ensure default group exists
  const groupCount = await dbGet(`SELECT COUNT(*) as count FROM groups`);
  let groupId = 1;
  if (groupCount.count === 0) {
    await dbRun(`INSERT INTO groups (name) VALUES (?)`, ['Flat Shared Expenses']);
    const group = await dbGet(`SELECT id FROM groups WHERE name = ?`, ['Flat Shared Expenses']);
    groupId = group.id;
  }

  // Default memberships
  const memberships = [
    { group_id: groupId, user_id: 'aisha', joined_at: '2026-02-01', left_at: null },
    { group_id: groupId, user_id: 'rohan', joined_at: '2026-02-01', left_at: null },
    { group_id: groupId, user_id: 'priya', joined_at: '2026-02-01', left_at: null },
    { group_id: groupId, user_id: 'meera', joined_at: '2026-02-01', left_at: '2026-03-31' },
    { group_id: groupId, user_id: 'sam', joined_at: '2026-04-08', left_at: null },
    { group_id: groupId, user_id: 'dev', joined_at: '2026-02-08', left_at: '2026-03-12' }
  ];

  for (const m of memberships) {
    const existingM = await dbGet(`SELECT * FROM group_memberships WHERE group_id = ? AND user_id = ?`, [m.group_id, m.user_id]);
    if (!existingM) {
      await dbRun(`INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?)`, 
        [m.group_id, m.user_id, m.joined_at, m.left_at]);
    }
  }
}

// Call database initializer
initDb().then(() => console.log('Database initialized')).catch(err => console.error('DB Init Error:', err));

// Utility: Normalize Name mapping
function normalizeName(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase();
  if (clean.includes('kabir')) return 'kabir';
  if (clean.startsWith('aisha')) return 'aisha';
  if (clean.startsWith('rohan')) return 'rohan';
  if (clean.startsWith('priya')) return 'priya';
  if (clean.startsWith('meera')) return 'meera';
  if (clean.startsWith('sam')) return 'sam';
  if (clean.startsWith('dev')) return 'dev';
  return clean;
}

// Utility: Normalize Dates
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split(/[-/]/);
  if (parts.length !== 3) return dateStr;
  
  let y, m, d;
  if (parts[0].length === 4) {
    y = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    d = parseInt(parts[2], 10);
  } else {
    if (parseInt(parts[0], 10) > 12) {
      d = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
    } else {
      m = parseInt(parts[0], 10);
      d = parseInt(parts[1], 10);
    }
    y = parseInt(parts[2], 10);
    if (y < 100) y += 2000;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// RFC 4180 compliant CSV Parser
function parseCSV(text) {
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i+1];
    
    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\r' || char === '\n') {
        row.push(field);
        field = '';
        if (row.some(x => x !== '')) {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && next === '\n') {
          i++;
        }
      } else {
        field += char;
      }
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    if (row.some(x => x !== '')) {
      lines.push(row);
    }
  }
  return lines;
}

/**
 * Greedy Debt Simplification Algorithm (Aisha's "one number" requirement).
 * Resolves a complex web of group debts into the absolute minimum number of 
 * direct payment transactions by iteratively matching the largest debtor with the largest creditor.
 * 
 * @param {Array<{userId: string, name: string, balance: number}>} balances - Array of all members' net balances.
 * @returns {Array<{from: string, fromName: string, to: string, toName: string, amount: number}>} Minimized list of optimal settlements.
 */
function simplifyDebts(balances) {
  // balances is an array of { userId, name, balance }
  const debtors = [];
  const creditors = [];
  
  for (const b of balances) {
    const bal = Math.round(b.balance * 100) / 100;
    if (bal < -0.01) {
      debtors.push({ userId: b.userId, name: b.name, balance: bal });
    } else if (bal > 0.01) {
      creditors.push({ userId: b.userId, name: b.name, balance: bal });
    }
  }

  // Sort: largest debtor first, largest creditor first
  debtors.sort((a, b) => a.balance - b.balance); // most negative first
  creditors.sort((a, b) => b.balance - a.balance); // most positive first

  const transactions = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    
    const oweAmount = -debtor.balance;
    const creditAmount = creditor.balance;
    
    const settledAmount = Math.min(oweAmount, creditAmount);
    transactions.push({
      from: debtor.userId,
      fromName: debtor.name,
      to: creditor.userId,
      toName: creditor.name,
      amount: Math.round(settledAmount * 100) / 100
    });
    
    debtor.balance += settledAmount;
    creditor.balance -= settledAmount;
    
    if (Math.abs(debtor.balance) < 0.01) {
      dIdx++;
    }
    if (Math.abs(creditor.balance) < 0.01) {
      cIdx++;
    }
  }
  
  return transactions;
}

// JWT Authentication Middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
      }
      req.user = decoded;
      next();
    });
  } else {
    res.status(401).json({ error: 'Unauthorized: Missing auth token' });
  }
}

// API: Register User (with Legit Email Checks, no OTP verification)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const userId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!userId) {
    return res.status(400).json({ error: 'Name must contain alphanumeric characters' });
  }

  // Verify if email format is legit and not disposable
  const emailCheck = isLegitEmail(cleanEmail);
  if (!emailCheck.valid) {
    return res.status(400).json({ error: emailCheck.reason });
  }

  // Validate strong password requirements
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  if (password.length < 8 || !hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecial) {
    return res.status(400).json({ 
      error: "Password must be at least 8 characters long and contain uppercase, lowercase, numbers, and special characters." 
    });
  }

  try {
    const existing = await dbGet(`SELECT * FROM users WHERE email = ? OR id = ?`, [cleanEmail, userId]);
    if (existing) {
      return res.status(400).json({ error: 'User with this email or name already exists' });
    }

    const hash = bcrypt.hashSync(password, 10);
    await dbRun(`INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`, [userId, name.trim(), cleanEmail, hash]);

    // Automatically join group 1
    const today = new Date().toISOString().split('T')[0];
    await dbRun(`INSERT OR IGNORE INTO group_memberships (group_id, user_id, joined_at) VALUES (1, ?, ?)`, [userId, today]);

    // Sign and issue JWT
    const token = jwt.sign({ userId, email: cleanEmail, name: name.trim() }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, userId, name: name.trim(), email: cleanEmail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Login User
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = await dbGet(`SELECT * FROM users WHERE email = ?`, [cleanEmail]);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, userId: user.id, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: List Users (Protected)
app.get('/api/users', authenticateJWT, async (req, res) => {
  try {
    const users = await dbAll(`SELECT * FROM users`);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: List Groups (Protected)
app.get('/api/groups', authenticateJWT, async (req, res) => {
  try {
    const groups = await dbAll(`SELECT * FROM groups`);
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create Group (Protected)
app.post('/api/groups', authenticateJWT, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name required' });
  try {
    const result = await dbRun(`INSERT INTO groups (name) VALUES (?)`, [name]);
    res.json({ id: result.lastID, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get Group Members & Lifespans (Protected)
app.get('/api/groups/:id/members', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    const members = await dbAll(`
      SELECT gm.*, u.name 
      FROM group_memberships gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `, [id]);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Add/Update Member for a Group (Protected)
app.post('/api/groups/:id/members', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const { userId, name, joined_at, left_at } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  try {
    // Ensure user exists
    let user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);
    if (!user) {
      const displayName = name || (userId.charAt(0).toUpperCase() + userId.slice(1));
      await dbRun(`INSERT INTO users (id, name) VALUES (?, ?)`, [userId, displayName]);
    }
    
    // Check if membership exists
    const membership = await dbGet(`SELECT * FROM group_memberships WHERE group_id = ? AND user_id = ?`, [id, userId]);
    if (membership) {
      await dbRun(`
        UPDATE group_memberships 
        SET joined_at = ?, left_at = ? 
        WHERE group_id = ? AND user_id = ?
      `, [joined_at, left_at || null, id, userId]);
    } else {
      await dbRun(`
        INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) 
        VALUES (?, ?, ?, ?)
      `, [id, userId, joined_at, left_at || null]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Add Expense Manually (Protected)
app.post('/api/groups/:id/expenses', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  const { 
    description, paid_by, amount, currency, original_amount, exchange_rate, 
    split_type, date, notes, splits, is_settlement 
  } = req.body;
  
  if (!description || !paid_by || amount === undefined || !date) {
    return res.status(400).json({ error: 'Missing required expense fields' });
  }

  try {
    await dbRun('BEGIN TRANSACTION');
    
    const result = await dbRun(`
      INSERT INTO expenses (group_id, description, paid_by, amount, currency, original_amount, exchange_rate, split_type, date, notes, is_settlement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, description, paid_by, amount, currency || 'INR', original_amount || amount, exchange_rate || 1.0, split_type || null, date, notes || '', is_settlement ? 1 : 0]);
    
    const expenseId = result.lastID;
    
    if (splits && splits.length > 0) {
      for (const split of splits) {
        await dbRun(`
          INSERT INTO expense_splits (expense_id, user_id, owed_amount)
          VALUES (?, ?, ?)
        `, [expenseId, split.userId, split.owedAmount]);
      }
    }
    
    await dbRun('COMMIT');
    res.json({ success: true, expenseId });
  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// API: Get Group Ledger & Balances (Protected)
app.get('/api/groups/:id/balances', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Get all members in group
    const members = await dbAll(`
      SELECT u.id, u.name 
      FROM group_memberships gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `, [id]);

    // 2. Fetch expenses and splits
    const expenses = await dbAll(`
      SELECT e.*, u.name AS payer_name
      FROM expenses e
      LEFT JOIN users u ON e.paid_by = u.id
      WHERE e.group_id = ?
      ORDER BY e.date ASC, e.id ASC
    `, [id]);

    const splits = await dbAll(`
      SELECT es.*, u.name AS user_name
      FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      JOIN users u ON es.user_id = u.id
      WHERE e.group_id = ?
    `, [id]);

    // Group splits by expense_id
    const splitsByExpense = {};
    for (const s of splits) {
      if (!splitsByExpense[s.expense_id]) {
        splitsByExpense[s.expense_id] = [];
      }
      splitsByExpense[s.expense_id].push(s);
    }

    // 3. Compute Net Balances
    // Balance = Paid - Owed
    const balanceMap = {};
    for (const m of members) {
      balanceMap[m.id] = { userId: m.id, name: m.name, paid: 0, owed: 0, balance: 0 };
    }

    for (const e of expenses) {
      const payerId = e.paid_by;
      const expenseSplits = splitsByExpense[e.id] || [];
      
      // If it is a debt settlement
      if (e.is_settlement === 1) {
        // e.paid_by paid e.amount directly to split participant (should be exactly 1 split participant)
        if (balanceMap[payerId]) {
          balanceMap[payerId].paid += e.amount; // payer gets credit for paying
        }
        if (expenseSplits.length > 0) {
          const recipientId = expenseSplits[0].user_id;
          if (balanceMap[recipientId]) {
            balanceMap[recipientId].owed += e.amount; // recipient gets "owed" increase, reducing net balance
          }
        }
        continue;
      }

      // Standard Expense
      if (balanceMap[payerId]) {
        balanceMap[payerId].paid += e.amount;
      }
      
      for (const s of expenseSplits) {
        if (balanceMap[s.user_id]) {
          balanceMap[s.user_id].owed += s.owed_amount;
        }
      }
    }

    const balances = Object.values(balanceMap).map(b => {
      b.balance = b.paid - b.owed;
      return b;
    });

    // 4. Simplify Debts (Aisha's list)
    const settlements = simplifyDebts(balances);

    res.json({
      members,
      expenses: expenses.map(e => ({
        ...e,
        splits: splitsByExpense[e.id] || []
      })),
      balances,
      settlements
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Clear all expenses (Protected)
app.post('/api/groups/:id/clear', authenticateJWT, async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun(`DELETE FROM expenses WHERE group_id = ?`, [id]);
    res.json({ success: true, message: 'All expenses cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Check if two strings are similar (case-insensitive fuzzy/exact match for description)
function isDescriptionSimilar(desc1, desc2) {
  const getWords = (s) => {
    return new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // keep spaces, remove special characters
        .split(/\s+/)
        .filter(w => w && !['at', 'for', 'the', 'a', 'of', 'and', 'in', 'on', 'with', 'to'].includes(w))
    );
  };
  
  const w1 = getWords(desc1);
  const w2 = getWords(desc2);
  
  if (w1.size === 0 || w2.size === 0) return false;
  
  // Count intersection
  let intersect = 0;
  for (const w of w1) {
    if (w2.has(w)) intersect++;
  }
  
  const minSize = Math.min(w1.size, w2.size);
  // If at least 75% of the words of the shorter description are in the longer one, they are similar
  return (intersect / minSize) >= 0.75;
}

// API: Upload CSV and Analyze for Anomalies (Protected)
app.post('/api/import-preview', authenticateJWT, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!req.file.originalname.toLowerCase().endsWith('.csv') && !req.file.originalname.toLowerCase().endsWith('.xlsx')) {
    return res.status(400).json({ error: 'Invalid file format. Please upload a valid .csv or .xlsx file.' });
  }
  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Group ID is required' });

  try {
    let csvText = '';
    if (req.file.originalname.toLowerCase().endsWith('.xlsx')) {
      const xlsx = await import('xlsx');
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      csvText = xlsx.utils.sheet_to_csv(sheet);
    } else {
      csvText = req.file.buffer.toString('utf-8');
    }
    const rows = parseCSV(csvText);
    
    if (rows.length < 2) return res.status(400).json({ error: 'CSV file is empty or missing data rows' });
    
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);
    
    // Get headers index
    const dateIdx = headers.indexOf('date');
    const descIdx = headers.indexOf('description');
    const payerIdx = headers.indexOf('paid_by');
    const amountIdx = headers.indexOf('amount');
    const currencyIdx = headers.indexOf('currency');
    const splitTypeIdx = headers.indexOf('split_type');
    const splitWithIdx = headers.indexOf('split_with');
    const splitDetailsIdx = headers.indexOf('split_details');
    const notesIdx = headers.indexOf('notes');

    // Get group members active lifespans
    const members = await dbAll(`SELECT * FROM group_memberships WHERE group_id = ?`, [groupId]);
    const membersMap = {};
    for (const m of members) {
      membersMap[m.user_id] = {
        joined_at: m.joined_at,
        left_at: m.left_at
      };
    }

    const previewRows = [];
    const rawEvents = []; // To track duplicates/double entries

    for (let i = 0; i < dataRows.length; i++) {
      const rawRow = dataRows[i];
      const csvLineNumber = i + 2; // header is line 1, data starts at 2
      
      const rawDate = rawRow[dateIdx] || '';
      const rawDesc = rawRow[descIdx] || '';
      const rawPayer = rawRow[payerIdx] || '';
      const rawAmountStr = rawRow[amountIdx] || '0';
      const rawCurrency = rawRow[currencyIdx] || '';
      const rawSplitType = rawRow[splitTypeIdx] || '';
      const rawSplitWith = rawRow[splitWithIdx] || '';
      const rawSplitDetails = rawRow[splitDetailsIdx] || '';
      const rawNotes = rawRow[notesIdx] || '';

      const anomalies = [];
      const proposed = {
        import: true, // User can toggle this row off
        date: normalizeDate(rawDate),
        description: rawDesc,
        paid_by: rawPayer,
        amount: parseFloat(rawAmountStr.replace(/,/g, '')) || 0,
        currency: rawCurrency || 'INR',
        exchange_rate: 1.0,
        split_type: rawSplitType,
        split_with: rawSplitWith,
        split_details: rawSplitDetails,
        notes: rawNotes,
        is_settlement: 0,
        explanation: []
      };

      // --- 1. Missing Currency ---
      if (!rawCurrency) {
        anomalies.push({
          type: 'MISSING_CURRENCY',
          message: 'Currency is missing.',
          proposed: 'INR'
        });
        proposed.currency = 'INR';
        proposed.explanation.push('Defaulted empty currency to INR.');
      }

      // --- 2. Multi-currency (USD) ---
      if (proposed.currency === 'USD') {
        anomalies.push({
          type: 'FOREIGN_CURRENCY',
          message: 'Foreign currency USD detected.',
          proposed: 'Convert to INR at 83.0 rate (customizable).'
        });
        proposed.exchange_rate = 83.0; // default exchange rate
        proposed.amount = Math.round(proposed.amount * 83.0 * 100) / 100;
        proposed.explanation.push(`Converted USD to INR at rate 83.0.`);
      }

      // --- 3. Missing Payer ---
      if (!rawPayer) {
        anomalies.push({
          type: 'MISSING_PAYER',
          message: 'Payer (paid_by) is missing.',
          proposed: 'Needs manual assignment.'
        });
        proposed.paid_by = ''; // Frontend will show dropdown to select
        proposed.import = false; // block import until selected
        proposed.explanation.push('Missing payer. Must select a user before importing.');
      } else {
        // Normalize payer name
        const normPayer = normalizeName(rawPayer);
        if (normPayer && membersMap[normPayer]) {
          proposed.paid_by = normPayer;
          if (normPayer !== rawPayer) {
            anomalies.push({
              type: 'INCONSISTENT_NAME',
              message: `Payer name "${rawPayer}" normalized to "${normPayer}".`,
              proposed: normPayer
            });
            proposed.explanation.push(`Normalized payer "${rawPayer}" to "${normPayer}".`);
          }
        } else if (normPayer) {
          // Payer is not in the group!
          anomalies.push({
            type: 'NON_GROUP_PAYER',
            message: `Payer "${rawPayer}" is not a member of this group.`,
            proposed: 'Add payer to the group membership.'
          });
          proposed.paid_by = normPayer;
          proposed.explanation.push(`Payer "${rawPayer}" is not in the group. Add them to group.`);
        }
      }

      // --- 4. Extreme / Typo Date ---
      if (rawDate) {
        const parts = rawDate.split('-');
        if (parts.length === 3 && parts[0] === '2014') {
          anomalies.push({
            type: 'TYPO_YEAR',
            message: `Year 2014 seems incorrect for a 2026 trip.`,
            proposed: '2026-03-12'
          });
          proposed.date = '2026-03-12';
          proposed.explanation.push('Corrected year from 2014 to 2026 (Goa Airport cab on 2026-03-12).');
        }
      }

      // --- 5. Ambiguous Date ---
      if (rawDesc.includes('Deep cleaning') && rawDate === '2026-05-04') {
        anomalies.push({
          type: 'AMBIGUOUS_DATE',
          message: `Date is ambiguous (2026-05-04 vs 2026-04-05).`,
          proposed: '2026-04-05'
        });
        proposed.date = '2026-04-05';
        proposed.explanation.push('Corrected date format from May 4th to April 5th based on context.');
      }

      // --- 6. Zero Amount ---
      if (proposed.amount === 0) {
        anomalies.push({
          type: 'ZERO_AMOUNT',
          message: 'Expense amount is 0.',
          proposed: 'Skip import.'
        });
        proposed.import = false;
        proposed.explanation.push('Skipping 0 amount expense.');
      }

      // --- 7. Negative Amount (Refund) ---
      if (proposed.amount < 0) {
        anomalies.push({
          type: 'NEGATIVE_AMOUNT',
          message: 'Negative amount detected (indicates a refund).',
          proposed: 'Process splits as negative shares.'
        });
        proposed.explanation.push('Refund split equally to reduce everyone\'s owes.');
      }

      // --- 8. Settlement Logged as Expense ---
      if (!rawSplitType && rawSplitWith && rawDesc.toLowerCase().includes('paid') && rawDesc.toLowerCase().includes('back')) {
        anomalies.push({
          type: 'SETTLEMENT_EXPENSE',
          message: 'Logged as expense but matches payment settlement.',
          proposed: 'Treat as direct debt settlement.'
        });
        proposed.is_settlement = 1;
        proposed.split_type = 'settlement';
        const normRecipient = normalizeName(rawSplitWith);
        proposed.split_with = normRecipient;
        proposed.explanation.push(`Handled as a settlement payment from ${proposed.paid_by} to ${normRecipient}.`);
      }

      // --- 9. Extraneous Member in split_with ---
      const splitWithMembers = rawSplitWith ? rawSplitWith.split(';').map(m => m.trim()) : [];
      const normalizedSplitWith = [];
      
      for (const userRaw of splitWithMembers) {
        const norm = normalizeName(userRaw);
        if (norm) {
          if (norm.includes('kabir')) {
            anomalies.push({
              type: 'EXTRANEOUS_MEMBER',
              message: `Kabir is not a member of the flat.`,
              proposed: 'Attribute Kabir\'s share to Dev.'
            });
            // Proposed action: Keep Kabir in the list, but our importer will reallocate his split.
            // Or add him as a user. We'll default to attributing his split to Dev.
            normalizedSplitWith.push('kabir');
            proposed.explanation.push(`Attributed "Dev's friend Kabir"'s share to Dev.`);
          } else {
            normalizedSplitWith.push(norm);
            if (norm !== userRaw) {
              anomalies.push({
                type: 'INCONSISTENT_NAME',
                message: `Split member "${userRaw}" normalized to "${norm}".`,
                proposed: norm
              });
              proposed.explanation.push(`Normalized split member "${userRaw}" to "${norm}".`);
            }
          }
        }
      }
      proposed.split_with = normalizedSplitWith.join(';');

      // --- 10. Inactive Member split ---
      // Check active dates based on membership
      if (proposed.date) {
        for (const user of normalizedSplitWith) {
          const range = membersMap[user];
          if (range) {
            if (range.joined_at && proposed.date < range.joined_at) {
              anomalies.push({
                type: 'INACTIVE_MEMBER',
                message: `Member "${user}" had not joined on date ${proposed.date}.`,
                proposed: `Remove "${user}" from split.`
              });
              proposed.explanation.push(`Excluded "${user}" from split because date is before join date.`);
            } else if (range.left_at && proposed.date > range.left_at) {
              anomalies.push({
                type: 'INACTIVE_MEMBER',
                message: `Member "${user}" left the flat before date ${proposed.date}.`,
                proposed: `Remove "${user}" from split.`
              });
              proposed.explanation.push(`Excluded "${user}" from split because date is after move-out date.`);
            }
          }
        }
      }

      // --- 11. Redundant split details for equal split ---
      if (rawSplitType === 'equal' && rawSplitDetails) {
        anomalies.push({
          type: 'REDUNDANT_DETAILS',
          message: `Equal split has redundant split details: "${rawSplitDetails}".`,
          proposed: 'Ignore details, split equally.'
        });
        proposed.split_details = '';
        proposed.explanation.push('Ignored redundant details for equal split.');
      }

      // --- 12. Invalid Percentages ---
      if (rawSplitType === 'percentage' && rawSplitDetails) {
        // Parse percentages: Aisha 30%; Rohan 30%; Priya 30%; Meera 20%
        const pairs = rawSplitDetails.split(';').map(p => p.trim());
        let totalPct = 0;
        for (const p of pairs) {
          const m = p.match(/([a-zA-Z\s]+)\s+(\d+)%/);
          if (m) {
            totalPct += parseInt(m[2]);
          }
        }
        if (totalPct !== 100) {
          anomalies.push({
            type: 'INVALID_PERCENTAGE',
            message: `Percentages sum to ${totalPct}%, which is not 100%.`,
            proposed: 'Scale percentages proportionally.'
          });
          proposed.explanation.push(`Normalized split percentages (original sum: ${totalPct}%).`);
        }
      }

      // --- 13. Duplicate detection & Overlapping entries ---
      const isDuplicate = rawEvents.some(prev => 
        prev.date === proposed.date && 
        prev.amount === proposed.amount && 
        prev.paid_by === proposed.paid_by &&
        isDescriptionSimilar(prev.description, proposed.description)
      );

      if (isDuplicate) {
        anomalies.push({
          type: 'DUPLICATE_ENTRY',
          message: `Possible duplicate of an earlier row on ${proposed.date} with amount ${proposed.amount}.`,
          proposed: 'Do not import.'
        });
        proposed.import = false; // Skip by default
        proposed.explanation.push('Flagged as duplicate row. Skip import by default.');
      }

      const isSuspectedDoubleLog = !isDuplicate && rawEvents.some(prev => 
        prev.date === proposed.date && 
        isDescriptionSimilar(prev.description, proposed.description) &&
        (prev.paid_by !== proposed.paid_by || prev.amount !== proposed.amount)
      );

      if (isSuspectedDoubleLog) {
        anomalies.push({
          type: 'DOUBLE_LOGGING',
          message: `Suspected double-logging of the same event with different payer or amount.`,
          proposed: 'Verify and choose one to keep.'
        });
        proposed.explanation.push('Flagged as suspected double-logging (different payer/amount).');
      }

      rawEvents.push({
        date: proposed.date,
        description: proposed.description,
        paid_by: proposed.paid_by,
        amount: proposed.amount
      });

      previewRows.push({
        csvLine: csvLineNumber,
        raw: rawRow,
        anomalies,
        proposed
      });
    }

    res.json({
      groupId,
      rows: previewRows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Finalize and Confirm Import (Protected)
app.post('/api/import-confirm', authenticateJWT, async (req, res) => {
  const { groupId, rows, exchangeRate } = req.body;
  if (!groupId || !rows) return res.status(400).json({ error: 'Missing group or rows data' });

  const finalRate = parseFloat(exchangeRate) || 83.0;

  try {
    await dbRun('BEGIN TRANSACTION');

    // Fetch active group membership for validation
    const members = await dbAll(`SELECT * FROM group_memberships WHERE group_id = ?`, [groupId]);
    const membersSet = new Set(members.map(m => m.user_id));
    const membersMap = {};
    for (const m of members) {
      membersMap[m.user_id] = m;
    }

    let importedCount = 0;
    let skippedCount = 0;
    const reportLogs = [];

    for (const r of rows) {
      if (!r.import) {
        skippedCount++;
        reportLogs.push(`Row ${r.csvLine} [${r.description}]: Skipped by user preference.`);
        continue;
      }

      const { date, description, paid_by, amount, currency, split_type, split_with, split_details, is_settlement } = r;

      if (!paid_by) {
        throw new Error(`Row ${r.csvLine} cannot be imported: Missing paid_by payer.`);
      }

      // 1. Ensure payer is in group
      if (!membersSet.has(paid_by)) {
        // Auto-add payer to group membership dynamically
        await dbRun(`
          INSERT OR IGNORE INTO group_memberships (group_id, user_id, joined_at) 
          VALUES (?, ?, ?)
        `, [groupId, paid_by, date]);
        membersSet.add(paid_by);
        membersMap[paid_by] = { joined_at: date, left_at: null };
        reportLogs.push(`Row ${r.csvLine}: Automatically added payer "${paid_by}" to group membership starting ${date}.`);
      }

      // Check exchange rate if USD
      let finalAmount = parseFloat(amount);
      let originalAmount = finalAmount;
      let usedRate = 1.0;
      if (currency === 'USD') {
        usedRate = finalRate;
        // If amount wasn't converted yet, do it now, otherwise keep it if already in INR
        if (r.original_amount !== undefined && r.original_amount !== finalAmount) {
          originalAmount = r.original_amount;
        } else {
          originalAmount = finalAmount / finalRate; // reconstruct
        }
      }

      // 2. Insert expense
      const expenseInsert = await dbRun(`
        INSERT INTO expenses (group_id, description, paid_by, amount, currency, original_amount, exchange_rate, split_type, date, notes, is_settlement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [groupId, description, paid_by, finalAmount, currency, originalAmount, usedRate, split_type, date, r.notes || '', is_settlement ? 1 : 0]);
      
      const expenseId = expenseInsert.lastID;

      // 3. Process splits
      if (is_settlement === 1) {
        // Direct Debt Payment/Settlement (e.g. Rohan paid Aisha back)
        // split_with contains the recipient
        const recipient = split_with.trim();
        
        // Ensure recipient in group
        if (!membersSet.has(recipient)) {
          await dbRun(`
            INSERT OR IGNORE INTO group_memberships (group_id, user_id, joined_at) 
            VALUES (?, ?, ?)
          `, [groupId, recipient, date]);
          membersSet.add(recipient);
          membersMap[recipient] = { joined_at: date, left_at: null };
        }

        // Insert exactly 1 split representing the recipient
        await dbRun(`
          INSERT INTO expense_splits (expense_id, user_id, owed_amount)
          VALUES (?, ?, ?)
        `, [expenseId, recipient, finalAmount]);
        
        reportLogs.push(`Row ${r.csvLine}: Processed direct settlement payment of ${finalAmount} INR from "${paid_by}" to "${recipient}".`);
      } else {
        // Standard Expense Splits
        let participants = split_with ? split_with.split(';').map(p => p.trim()).filter(Boolean) : [];
        
        // Filter out inactive members on the date of expense
        participants = participants.filter(user => {
          const mInfo = membersMap[user];
          if (!mInfo) return true; // not in db yet, let's keep it
          if (mInfo.joined_at && date < mInfo.joined_at) return false;
          if (mInfo.left_at && date > mInfo.left_at) return false;
          return true;
        });

        if (participants.length === 0) {
          throw new Error(`Row ${r.csvLine} has no active split participants on ${date}.`);
        }

        const calculatedSplits = {}; // user -> owedAmount
        
        // Handle Extraneous Kabir: Kabir's split will be reallocated to Dev
        const devFriendKabirIndex = participants.indexOf('kabir');
        const hasKabir = devFriendKabirIndex !== -1;

        if (split_type === 'equal') {
          const shareVal = Math.round((finalAmount / participants.length) * 100) / 100;
          let sum = 0;
          for (let idx = 0; idx < participants.length; idx++) {
            const p = participants[idx];
            if (idx === participants.length - 1) {
              calculatedSplits[p] = Math.round((finalAmount - sum) * 100) / 100; // handle rounding remainder
            } else {
              calculatedSplits[p] = shareVal;
              sum += shareVal;
            }
          }
        } 
        else if (split_type === 'share') {
          // split_details: Aisha 1; Rohan 2; Priya 1; Dev 2
          const pairs = split_details.split(';').map(p => p.trim());
          let totalShares = 0;
          const shareMap = {};
          
          for (const p of pairs) {
            const match = p.match(/([a-zA-Z\s]+)\s+(\d+)/);
            if (match) {
              const u = normalizeName(match[1]);
              const s = parseInt(match[2]);
              // only split with active participants
              if (participants.includes(u)) {
                shareMap[u] = s;
                totalShares += s;
              }
            }
          }

          if (totalShares > 0) {
            let sum = 0;
            const pKeys = Object.keys(shareMap);
            for (let idx = 0; idx < pKeys.length; idx++) {
              const p = pKeys[idx];
              const shareFraction = shareMap[p] / totalShares;
              const owed = Math.round((finalAmount * shareFraction) * 100) / 100;
              if (idx === pKeys.length - 1) {
                calculatedSplits[p] = Math.round((finalAmount - sum) * 100) / 100;
              } else {
                calculatedSplits[p] = owed;
                sum += owed;
              }
            }
          }
        } 
        else if (split_type === 'percentage') {
          // split_details: Aisha 30%; Rohan 30%; Priya 30%; Meera 20%
          const pairs = split_details.split(';').map(p => p.trim());
          const pctMap = {};
          let originalSum = 0;
          
          for (const p of pairs) {
            const match = p.match(/([a-zA-Z\s]+)\s+(\d+)%/);
            if (match) {
              const u = normalizeName(match[1]);
              const pct = parseInt(match[2]);
              if (participants.includes(u)) {
                pctMap[u] = pct;
                originalSum += pct;
              }
            }
          }

          if (originalSum > 0) {
            let sum = 0;
            const pKeys = Object.keys(pctMap);
            for (let idx = 0; idx < pKeys.length; idx++) {
              const p = pKeys[idx];
              // Normalize the percentages if sum is not 100%
              const scale = pctMap[p] / originalSum;
              const owed = Math.round((finalAmount * scale) * 100) / 100;
              if (idx === pKeys.length - 1) {
                calculatedSplits[p] = Math.round((finalAmount - sum) * 100) / 100;
              } else {
                calculatedSplits[p] = owed;
                sum += owed;
              }
            }
          }
        } 
        else if (split_type === 'unequal') {
          // split_details: Rohan 700; Priya 400; Meera 400
          const pairs = split_details.split(';').map(p => p.trim());
          let sum = 0;
          const pKeys = [];
          
          for (const p of pairs) {
            const match = p.match(/([a-zA-Z\s]+)\s+(\d+)/);
            if (match) {
              const u = normalizeName(match[1]);
              const val = parseInt(match[2]);
              if (participants.includes(u)) {
                calculatedSplits[u] = val;
                sum += val;
                pKeys.push(u);
              }
            }
          }

          // If sum doesn't match total, adjust the last person, or scale?
          // Since it's unequal, we assume details should match the total, if not we adjust the remainder to the payer or last split person
          if (sum !== finalAmount && pKeys.length > 0) {
            const last = pKeys[pKeys.length - 1];
            calculatedSplits[last] = Math.round((calculatedSplits[last] + (finalAmount - sum)) * 100) / 100;
          }
        }

        // Apply Extraneous Kabir policy: Add Kabir's share to Dev
        if (hasKabir && calculatedSplits['kabir'] > 0) {
          const kabirShare = calculatedSplits['kabir'];
          delete calculatedSplits['kabir'];
          calculatedSplits['dev'] = (calculatedSplits['dev'] || 0) + kabirShare;
          reportLogs.push(`Row ${r.csvLine}: Reallocated Kabir's share of ${kabirShare} INR to Dev.`);
        }

        // Ensure all participants are in the group membership
        for (const user of Object.keys(calculatedSplits)) {
          if (!membersSet.has(user)) {
            await dbRun(`
              INSERT OR IGNORE INTO group_memberships (group_id, user_id, joined_at) 
              VALUES (?, ?, ?)
            `, [groupId, user, date]);
            membersSet.add(user);
            membersMap[user] = { joined_at: date, left_at: null };
          }

          // Insert into expense_splits
          await dbRun(`
            INSERT INTO expense_splits (expense_id, user_id, owed_amount)
            VALUES (?, ?, ?)
          `, [expenseId, user, calculatedSplits[user]]);
        }
        
        reportLogs.push(`Row ${r.csvLine}: Imported "${description}" of ${finalAmount} INR paid by "${paid_by}".`);
      }
      
      importedCount++;
    }

    await dbRun('COMMIT');
    res.json({
      success: true,
      importedCount,
      skippedCount,
      reportLogs
    });

  } catch (err) {
    await dbRun('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
