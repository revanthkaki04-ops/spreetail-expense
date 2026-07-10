// --- App State ---
let state = {
  currentUser: null,
  activeGroup: null,
  groups: [],
  users: [],
  members: [],
  balances: [],
  expenses: [],
  settlements: [],
  previewRows: [], // Holds rows for CSV preview
  usdExchangeRate: 83.0,
  authMode: 'login' // 'login' or 'register'
};
// --- Security Utilities ---
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  checkLoginState();
});

// --- Authenticated Fetch Helper ---
async function authFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  options.headers = options.headers || {};
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(url, options);
  
  if (res.status === 401 || res.status === 403) {
    handleLogout();
    throw new Error('Session expired or unauthorized. Please log in.');
  }
  
  // Resilience: Safely intercept res.json() to prevent frontend crashes on 500 HTML errors
  res.json = async () => {
    try {
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (e) {
      console.warn('API returned a non-JSON response:', e);
      return { error: 'An unexpected server error occurred. Please try again later.' };
    }
  };
  
  return res;
}

// --- Theme Management ---
function initTheme() {
  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.querySelector('#btnThemeToggle i');
  if (icon) {
    icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    lucide.createIcons();
  }
}

// --- Session State & Login ---
function checkLoginState() {
  const storedUser = localStorage.getItem('currentUser');
  const token = localStorage.getItem('authToken');
  
  if (storedUser && token) {
    state.currentUser = storedUser;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadUsers().then(() => {
      loadGroups().then(() => {
        lucide.createIcons();
        checkShowOnboarding();
      });
    });
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
}

async function handleLogin() {
  const errorEl = document.getElementById('loginError');
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
  
  errorEl.style.backgroundColor = '';
  errorEl.style.color = '';
  errorEl.style.borderColor = '';
  errorEl.className = 'login-error-message';

  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value.trim();

  if (!email || !password) {
    errorEl.textContent = 'Please enter both email and password.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    let res;
    if (state.authMode === 'register') {
      if (!name) {
        errorEl.textContent = 'Please enter your full name to register.';
        errorEl.classList.remove('hidden');
        return;
      }
      
      // Client-side Email format validation
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        errorEl.textContent = "Email format is incorrect. We need an '@' and a domain (e.g. gmail.com)";
        errorEl.classList.remove('hidden');
        return;
      }
      
      // Client-side Password strength validation
      const hasUpperCase = /[A-Z]/.test(password);
      const hasLowerCase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[^A-Za-z0-9]/.test(password);

      if (password.length < 8 || !hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecial) {
        errorEl.textContent = "Password must be at least 8 characters long and contain uppercase, lowercase, numbers, and special characters.";
        errorEl.classList.remove('hidden');
        return;
      }

      res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
    } else {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
    }

    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Authentication failed.';
      errorEl.classList.remove('hidden');
      return;
    }

    localStorage.setItem('authToken', data.token);
    localStorage.setItem('currentUser', data.userId);
    
    // Clear inputs
    document.getElementById('authEmail').value = '';
    document.getElementById('authPassword').value = '';
    document.getElementById('authName').value = '';

    checkLoginState();
  } catch (err) {
    errorEl.textContent = `Server error: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
}

function handleLogout() {
  localStorage.removeItem('currentUser');
  localStorage.removeItem('authToken');
  state.currentUser = null;
  
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authName').value = '';
  
  const errorEl = document.getElementById('loginError');
  errorEl.classList.add('hidden');
  
  checkLoginState();
}

// --- Fetching API Data ---
async function loadUsers() {
  const res = await authFetch('/api/users');
  state.users = await res.json();
}

async function loadGroups() {
  const res = await authFetch('/api/groups');
  state.groups = await res.json();
  
  const select = document.getElementById('groupSelect');
  select.innerHTML = '';
  state.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  });

  if (state.groups.length > 0) {
    // Default to the first group
    state.activeGroup = state.groups[0].id;
    select.value = state.activeGroup;
    await switchGroup(state.activeGroup);
  } else {
    // Graceful Empty State
    state.activeGroup = null;
    state.members = [];
    state.balances = [];
    state.expenses = [];
    state.settlements = [];
    
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = "No Groups Available";
    select.appendChild(opt);
    
    renderDashboard();
    renderLedger();
    updateProfileUI();
  }
}

async function switchGroup(groupId) {
  state.activeGroup = parseInt(groupId);
  document.getElementById('groupSelect').value = groupId;
  
  // Load members, balances, ledger
  await loadMembers();
  await loadBalances();
  updateProfileUI();
}

async function loadMembers() {
  const res = await authFetch(`/api/groups/${state.activeGroup}/members`);
  state.members = await res.json();
  renderMembersTable();
}

async function loadBalances() {
  const res = await authFetch(`/api/groups/${state.activeGroup}/balances`);
  const data = await res.json();
  state.balances = data.balances;
  state.expenses = data.expenses;
  state.settlements = data.settlements;

  renderDashboard();
  renderLedger();
}

// --- Render Functions ---
function updateProfileUI() {
  const currentUserObj = state.users.find(u => u.id === state.currentUser);
  const name = currentUserObj ? currentUserObj.name : state.currentUser;
  
  document.getElementById('currentUserName').textContent = name;
  document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
}

function renderDashboard() {
  // 1. Calculate active user balance
  const activeBal = state.balances.find(b => b.userId === state.currentUser);
  
  let paid = 0;
  let owed = 0;
  let net = 0;

  if (activeBal) {
    paid = activeBal.paid;
    owed = activeBal.owed;
    net = activeBal.balance;
  }

  document.getElementById('summaryYouOwe').textContent = `₹${owed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('summaryYouAreOwed').textContent = `₹${paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  const netEl = document.getElementById('summaryNetBalance');
  netEl.textContent = `₹${net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  
  if (net < -0.01) {
    netEl.className = 'text-danger';
  } else if (net > 0.01) {
    netEl.className = 'text-success';
  } else {
    netEl.className = '';
  }

  // 2. Render optimized settlements plan (Aisha's View)
  const setList = document.getElementById('settlementsList');
  setList.innerHTML = '';
  
  if (state.settlements.length === 0) {
    setList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="check-circle"></i>
        <span>All settled! No debts to pay.</span>
      </div>
    `;
  } else {
    state.settlements.forEach(s => {
      const item = document.createElement('div');
      item.className = 'settlement-item';
      
      const isFromMe = s.from === state.currentUser;
      const isToMe = s.to === state.currentUser;
      
      let highlightClass = '';
      if (isFromMe) highlightClass = 'border-danger';
      if (isToMe) highlightClass = 'border-success';

      item.innerHTML = `
        <div class="settlement-member">
          <strong class="${isFromMe ? 'text-danger' : ''}">${escapeHTML(s.fromName)}</strong>
          <span class="settlement-arrow"><i data-lucide="arrow-right"></i></span>
          <strong class="${isToMe ? 'text-success' : ''}">${escapeHTML(s.toName)}</strong>
        </div>
        <div class="settlement-amount">₹${s.amount.toFixed(2)}</div>
      `;
      setList.appendChild(item);
    });
  }

  // 3. Render flatmate balances
  const membersBalList = document.getElementById('membersBalancesList');
  membersBalList.innerHTML = '';

  state.balances.forEach(b => {
    const row = document.createElement('div');
    row.className = 'member-balance-row';
    
    let balColorClass = '';
    let balTextPrefix = '';
    if (b.balance > 0.01) {
      balColorClass = 'text-success';
      balTextPrefix = '+';
    } else if (b.balance < -0.01) {
      balColorClass = 'text-danger';
    }

    const safeName = escapeHTML(b.name);
    
    row.innerHTML = `
      <div class="member-badge">
        <div class="avatar" style="background-color: ${b.userId === state.currentUser ? 'var(--accent-primary)' : '#475569'}">${safeName.charAt(0).toUpperCase()}</div>
        <span>${safeName} ${b.userId === state.currentUser ? '(You)' : ''}</span>
      </div>
      <div class="member-val-box">
        <div class="member-net-bal ${balColorClass}">${balTextPrefix}₹${b.balance.toFixed(2)}</div>
        <div class="member-details">Paid: ₹${b.paid.toFixed(2)} • Owed: ₹${b.owed.toFixed(2)}</div>
      </div>
    `;
    membersBalList.appendChild(row);
  });

  // 4. Render Recent Expenses
  const recentExpTable = document.querySelector('#dashboardExpensesTable tbody');
  if (recentExpTable) {
    recentExpTable.innerHTML = '';
    const recent = [...state.expenses].reverse().slice(0, 10);
    
    if (recent.length === 0) {
      recentExpTable.innerHTML = `<tr><td colspan="4" class="text-secondary" style="text-align: center;">No expenses imported yet.</td></tr>`;
    } else {
      recent.forEach(e => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHTML(e.date)}</td>
          <td>
            <strong>${escapeHTML(e.description)}</strong>
            <div class="text-secondary" style="font-size: 0.8rem;">Split: ${escapeHTML(e.split_type)}</div>
          </td>
          <td>${escapeHTML(e.payer_name)}</td>
          <td class="text-right"><strong>${escapeHTML(e.currency)} ${e.amount.toFixed(2)}</strong></td>
          <td>
            <button class="btn-icon-sm btn-danger-ghost" onclick="deleteExpense(${e.id})" title="Delete expense">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        `;
        recentExpTable.appendChild(row);
      });
    }
  }

  lucide.createIcons();
}

function renderLedger() {
  const tbody = document.getElementById('ledgerTableBody');
  tbody.innerHTML = '';
  
  // Show Rohan's transparent ledger list
  // Find all expenses involving currentUser
  const filteredExpenses = state.expenses.filter(e => {
    return e.paid_by === state.currentUser || e.splits.some(s => s.user_id === state.currentUser);
  });

  if (filteredExpenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-secondary" style="text-align: center;">No transactions found.</td></tr>`;
    return;
  }

  filteredExpenses.forEach(e => {
    const row = document.createElement('tr');
    
    // Find currentUser owed split
    const mySplit = e.splits.find(s => s.user_id === state.currentUser);
    const owedAmount = mySplit ? mySplit.owed_amount : 0;
    
    const paidByMe = e.paid_by === state.currentUser;
    const netEffect = (paidByMe ? e.amount : 0) - owedAmount;
    
    let netColorClass = '';
    let netText = '';
    if (netEffect > 0.01) {
      netColorClass = 'text-success';
      netText = `+₹${netEffect.toFixed(2)}`;
    } else if (netEffect < -0.01) {
      netColorClass = 'text-danger';
      netText = `-₹${Math.abs(netEffect).toFixed(2)}`;
    } else {
      netText = '₹0.00';
    }

    const dateStr = e.date;
    const currencyTag = e.currency !== 'INR' ? ` (${e.original_amount.toFixed(2)} ${escapeHTML(e.currency)})` : '';
    const safeDesc = escapeHTML(e.description);
    const safeNotes = escapeHTML(e.notes || '');
    const safePayer = escapeHTML(e.payer_name);

    row.innerHTML = `
      <td>${escapeHTML(dateStr)}</td>
      <td><strong>${safeDesc}</strong>${e.is_settlement ? ' <span class="badge info">Settlement</span>' : ''}</td>
      <td>${safePayer}</td>
      <td>₹${e.amount.toFixed(2)}${currencyTag}</td>
      <td>₹${owedAmount.toFixed(2)}</td>
      <td class="${netColorClass} font-weight-bold">${netText}</td>
      <td class="text-secondary" style="font-size: 0.8rem;">${safeNotes}</td>
      <td>
        <button class="btn-icon-sm btn-danger-ghost" onclick="deleteExpense(${e.id})" title="Delete expense">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderMembersTable() {
  const tbody = document.getElementById('membersTableBody');
  tbody.innerHTML = '';
  
  state.members.forEach(m => {
    const row = document.createElement('tr');
    
    const now = new Date().toISOString().split('T')[0];
    let active = true;
    if (m.joined_at && now < m.joined_at) active = false;
    if (m.left_at && now > m.left_at) active = false;

    row.innerHTML = `
      <td><strong>${escapeHTML(m.user_id)}</strong></td>
      <td>${escapeHTML(m.name)}</td>
      <td>${escapeHTML(m.joined_at || '')}</td>
      <td>${m.left_at ? escapeHTML(m.left_at) : '<span class="text-secondary">Present</span>'}</td>
      <td>
        <span class="badge ${active ? 'success' : 'danger'}">
          ${active ? 'Active' : 'Moved Out/Inactive'}
        </span>
      </td>
      <td style="display: flex; gap: 0.25rem;">
        <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="editMember('${escapeHTML(m.user_id)}', '${escapeHTML(m.joined_at || '')}', '${escapeHTML(m.left_at || '')}')"><i data-lucide="edit"></i> Edit</button>
        <button class="btn btn-outline btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="removeMember('${escapeHTML(m.user_id)}')"><i data-lucide="user-minus"></i> Remove</button>
      </td>
    `;
    tbody.appendChild(row);
  });
  lucide.createIcons();
}

window.editMember = (userId, joinedAt, leftAt) => {
  document.getElementById('memberUserId').value = userId;
  document.getElementById('memberJoinedAt').value = joinedAt;
  document.getElementById('memberLeftAt').value = leftAt;
  
  // Navigate/scroll to form
  document.getElementById('memberUserId').focus();
};

window.deleteExpense = async (expenseId) => {
  if (!confirm('Are you sure you want to delete this expense? This cannot be undone.')) return;
  try {
    const res = await authFetch(`/api/expenses/${expenseId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      await loadBalances();
    } else {
      alert(`Error: ${data.error || 'Failed to delete expense'}`);
    }
  } catch (err) {
    alert(`Error deleting expense: ${err.message}`);
  }
};

window.removeMember = async (userId) => {
  if (!confirm(`Remove "${userId}" from this group? Their expense history will be preserved.`)) return;
  try {
    const res = await authFetch(`/api/groups/${state.activeGroup}/members/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (data.warning) {
        alert(data.warning);
      }
      await loadMembers();
      await loadBalances();
    } else {
      alert(`Error: ${data.error || 'Failed to remove member'}`);
    }
  } catch (err) {
    alert(`Error removing member: ${err.message}`);
  }
};

// --- Add Manual Expense / Settlement Forms ---
function setupExpenseModalForm() {
  const payerSelect = document.getElementById('expPayer');
  const recipientSelect = document.getElementById('expRecipient');
  
  payerSelect.innerHTML = '';
  recipientSelect.innerHTML = '';
  
  // Populate dropdowns with active members
  state.members.forEach(m => {
    const opt1 = document.createElement('option');
    opt1.value = m.user_id;
    opt1.textContent = m.name;
    payerSelect.appendChild(opt1);
    
    const opt2 = document.createElement('option');
    opt2.value = m.user_id;
    opt2.textContent = m.name;
    recipientSelect.appendChild(opt2);
  });

  // Render split details checkbox config
  const splitMembersList = document.getElementById('splitMembersList');
  splitMembersList.innerHTML = '';

  state.members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'split-member-checkbox-row';
    
    row.innerHTML = `
      <label>
        <input type="checkbox" class="split-member-checkbox" value="${m.user_id}" checked onchange="toggleSplitDetailsInput()">
        <span>${m.name}</span>
      </label>
      <input type="number" class="split-member-val-input" data-user="${m.user_id}" placeholder="value" step="0.01" style="display: none;">
    `;
    splitMembersList.appendChild(row);
  });

  document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
  toggleSplitDetailsInput();
}

window.toggleSplitDetailsInput = () => {
  const method = document.getElementById('expSplitType').value;
  const rows = document.querySelectorAll('.split-member-checkbox-row');
  
  rows.forEach(r => {
    const cb = r.querySelector('.split-member-checkbox');
    const input = r.querySelector('.split-member-val-input');
    
    if (method === 'equal') {
      input.style.display = 'none';
      input.disabled = true;
    } else {
      input.style.display = 'block';
      input.disabled = !cb.checked;
      if (method === 'percentage') {
        input.placeholder = '%';
      } else if (method === 'share') {
        input.placeholder = 'share';
      } else {
        input.placeholder = '₹';
      }
    }
  });
};

document.getElementById('expSplitType').addEventListener('change', toggleSplitDetailsInput);

// --- CSV Import Operations ---
async function analyzeCSVFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('groupId', state.activeGroup);

  try {
    const res = await authFetch('/api/import-preview', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      const err = await res.json();
      alert(`Import Analysis failed: ${err.error}`);
      return;
    }

    const data = await res.json();
    state.previewRows = data.rows;
    renderImportPreview();
    
    document.getElementById('uploaderContainer').classList.add('hidden');
    document.getElementById('importerPreviewContainer').classList.remove('hidden');
  } catch (err) {
    alert(`File Analysis Error: ${err.message}`);
  }
}

function renderImportPreview() {
  const container = document.getElementById('anomalyRowsList');
  container.innerHTML = '';

  state.previewRows.forEach((r, rowIdx) => {
    const card = document.createElement('div');
    card.className = `anomaly-row-card ${r.proposed.import ? '' : 'ignored'}`;
    card.id = `anomaly-row-${rowIdx}`;

    // Render Badges
    let badgeHTML = '';
    r.anomalies.forEach(a => {
      let bClass = 'info';
      if (a.type === 'DUPLICATE_ENTRY' || a.type === 'MISSING_PAYER') bClass = 'danger';
      if (a.type === 'TYPO_YEAR' || a.type === 'INVALID_PERCENTAGE' || a.type === 'INACTIVE_MEMBER' || a.type === 'EXTRANEOUS_MEMBER') bClass = 'warning';
      
      badgeHTML += `<span class="badge ${bClass}">${a.type.replace('_', ' ')}</span>`;
    });

    if (r.anomalies.length === 0) {
      badgeHTML = `<span class="badge success">Clean Record</span>`;
    }

    // Dropdown for payer selection
    let payerSelectHTML = `<select class="row-payer-select" onchange="updatePreviewRowValue(${rowIdx}, 'paid_by', this.value)">`;
    state.members.forEach(m => {
      const sel = r.proposed.paid_by === m.user_id ? 'selected' : '';
      payerSelectHTML += `<option value="${escapeHTML(m.user_id)}" ${sel}>${escapeHTML(m.name)}</option>`;
    });
    // Add missing option if any
    if (r.proposed.paid_by && !state.members.some(m => m.user_id === r.proposed.paid_by)) {
      payerSelectHTML += `<option value="${escapeHTML(r.proposed.paid_by)}" selected>${escapeHTML(r.proposed.paid_by)} (Add/Reallocate)</option>`;
    }
    payerSelectHTML += `</select>`;

    // Split type selection dropdown
    const splitTypeSelectHTML = `
      <select class="row-split-type-select" onchange="updatePreviewRowValue(${rowIdx}, 'split_type', this.value)">
        <option value="equal" ${r.proposed.split_type === 'equal' ? 'selected' : ''}>Equal</option>
        <option value="share" ${r.proposed.split_type === 'share' ? 'selected' : ''}>Share</option>
        <option value="percentage" ${r.proposed.split_type === 'percentage' ? 'selected' : ''}>Percentage</option>
        <option value="unequal" ${r.proposed.split_type === 'unequal' ? 'selected' : ''}>Unequal</option>
        <option value="settlement" ${r.proposed.is_settlement === 1 ? 'selected' : ''}>Debt Settlement</option>
      </select>
    `;

    card.innerHTML = `
      <div class="anomaly-row-header">
        <div class="row-identity">
          <span class="csv-badge">Row ${r.csvLine}</span>
          <span class="row-desc">${escapeHTML(r.proposed.description)}</span>
        </div>
        <div class="badges-list">${badgeHTML}</div>
      </div>
      
      <div class="anomaly-editor-grid">
        <div class="editor-left">
          <div class="editor-field-row">
            <div class="form-group">
              <label>Description</label>
              <input type="text" value="${escapeHTML(r.proposed.description)}" oninput="updatePreviewRowValue(${rowIdx}, 'description', this.value)">
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" value="${escapeHTML(r.proposed.date)}" onchange="updatePreviewRowValue(${rowIdx}, 'date', this.value)">
            </div>
          </div>
          
          <div class="editor-field-row">
            <div class="form-group">
              <label>Payer (Paid By)</label>
              <div class="select-wrapper">
                ${payerSelectHTML}
                <i data-lucide="chevron-down" class="select-chevron"></i>
              </div>
            </div>
            <div class="form-group">
              <label>Amount (INR)</label>
              <input type="number" value="${r.proposed.amount}" step="0.01" oninput="updatePreviewRowValue(${rowIdx}, 'amount', this.value)">
            </div>
            <div class="form-group">
              <label>Split Method</label>
              <div class="select-wrapper">
                ${splitTypeSelectHTML}
                <i data-lucide="chevron-down" class="select-chevron"></i>
              </div>
            </div>
          </div>

          <div class="editor-field-row">
            <div class="form-group" style="flex: 2;">
              <label>Split Targets (split_with / recipient)</label>
              <input type="text" value="${escapeHTML(r.proposed.split_with)}" placeholder="e.g. aisha;rohan" oninput="updatePreviewRowValue(${rowIdx}, 'split_with', this.value)">
            </div>
            <div class="form-group" style="flex: 3;">
              <label>Split Details (percentages/shares/amounts)</label>
              <input type="text" value="${escapeHTML(r.proposed.split_details || '')}" placeholder="e.g. aisha 30%; rohan 70%" oninput="updatePreviewRowValue(${rowIdx}, 'split_details', this.value)">
            </div>
          </div>
        </div>

        <div class="editor-right">
          <div class="explanations">
            <h5>System Actions Taken</h5>
            <ul>
              ${r.proposed.explanation.map(exp => `<li>${escapeHTML(exp)}</li>`).join('')}
              ${r.anomalies.length === 0 ? '<li>Verified and safe to import.</li>' : ''}
            </ul>
          </div>
          
          <div class="row-toggle-action">
            <span><strong>Status:</strong> <span class="status-lbl text-success">${r.proposed.import ? 'Importing' : 'Skipping'}</span></span>
            <label class="switch">
              <input type="checkbox" ${r.proposed.import ? 'checked' : ''} onchange="toggleImportRow(${rowIdx}, this.checked)">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
  
  lucide.createIcons();
}

window.updatePreviewRowValue = (rowIdx, field, val) => {
  const row = state.previewRows[rowIdx];
  if (field === 'amount') {
    row.proposed[field] = parseFloat(val) || 0;
  } else if (field === 'split_type') {
    if (val === 'settlement') {
      row.proposed.is_settlement = 1;
      row.proposed.split_type = 'settlement';
    } else {
      row.proposed.is_settlement = 0;
      row.proposed.split_type = val;
    }
  } else {
    row.proposed[field] = val;
  }
};

window.toggleImportRow = (rowIdx, checked) => {
  const card = document.getElementById(`anomaly-row-${rowIdx}`);
  const statusLbl = card.querySelector('.status-lbl');
  
  state.previewRows[rowIdx].proposed.import = checked;
  
  if (checked) {
    card.classList.remove('ignored');
    statusLbl.textContent = 'Importing';
    statusLbl.className = 'status-lbl text-success';
  } else {
    card.classList.add('ignored');
    statusLbl.textContent = 'Skipping';
    statusLbl.className = 'status-lbl text-danger';
  }
};

async function executeConfirmImport() {
  const btn = document.getElementById('btnConfirmImport');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Importing...';
  }

  const exchangeRate = parseFloat(document.getElementById('usdRateInput').value) || 83.0;
  const payloadRows = state.previewRows.map(r => ({
    ...r.proposed,
    csvLine: r.csvLine
  }));

  try {
    const res = await authFetch('/api/import-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: state.activeGroup,
        exchangeRate: exchangeRate,
        rows: payloadRows
      })
    });

    const result = await res.json();
    
    if (result.success) {
      document.getElementById('importerPreviewContainer').classList.add('hidden');
      document.getElementById('importReportContainer').classList.remove('hidden');
      
      document.getElementById('reportImportedCount').textContent = result.importedCount;
      document.getElementById('reportSkippedCount').textContent = result.skippedCount;
      
      const consoleEl = document.getElementById('reportLogsConsole');
      consoleEl.textContent = result.reportLogs.join('\n');
      
      // Reload state in background
      await loadBalances();
    } else {
      alert(`Import Confirmation failed: ${result.error}`);
    }
  } catch (err) {
    alert(`Import Confirmation error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirm and Import';
    }
  }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Mobile Sidebar Toggle
  const btnSidebarToggle = document.getElementById('btnSidebarToggle');
  const sidebar = document.querySelector('.sidebar');
  const mobileOverlay = document.getElementById('mobileOverlay');

  const closeSidebar = () => {
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (mobileOverlay) mobileOverlay.classList.remove('active');
  };

  if (btnSidebarToggle && sidebar && mobileOverlay) {
    btnSidebarToggle.addEventListener('click', () => {
      sidebar.classList.add('mobile-open');
      mobileOverlay.classList.add('active');
    });
    mobileOverlay.addEventListener('click', closeSidebar);
  }

  // Login / Register tab selectors
  const tabLogin = document.getElementById('tabAuthLogin');
  const tabRegister = document.getElementById('tabAuthRegister');
  const groupRegName = document.getElementById('groupRegisterName');
  const loginSubmit = document.getElementById('btnLoginSubmit');
  const loginSubtitle = document.getElementById('loginSubtitle');

  tabLogin.addEventListener('click', () => {
    state.authMode = 'login';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    groupRegName.classList.add('hidden');
    loginSubmit.textContent = 'Sign In';
    loginSubtitle.textContent = 'Sign in to your flat account';
    document.getElementById('loginError').classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    state.authMode = 'register';
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    groupRegName.classList.remove('hidden');
    loginSubmit.textContent = 'Create Account';
    loginSubtitle.textContent = 'Create a new flatmate profile';
    document.getElementById('loginError').classList.add('hidden');
  });

  // Password Visibility Toggle
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const authPassword = document.getElementById('authPassword');
  if (btnTogglePassword && authPassword) {
    btnTogglePassword.addEventListener('click', () => {
      const type = authPassword.getAttribute('type') === 'password' ? 'text' : 'password';
      authPassword.setAttribute('type', type);
      
      const icon = btnTogglePassword.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', type === 'password' ? 'eye' : 'eye-off');
        lucide.createIcons();
      }
    });
  }

  // Add Expense Button — opens the expense/settlement modal
  // (Modal form handles both manual expenses and payment settlements)

  // Nav Tab Buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      closeSidebar();
      const tab = btn.getAttribute('data-tab');
      if (!tab) return;
      
      // Toggle sidebar active
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle tab page
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      const activePane = document.getElementById(`tab-${tab}`);
      if (activePane) {
        activePane.classList.add('active');
      }

      // Page headers
      const title = document.getElementById('tabTitle');
      const subtitle = document.getElementById('tabSubtitle');
      
      if (tab === 'dashboard') {
        title.textContent = 'Dashboard';
        subtitle.textContent = 'Summary of flat shared expenses';
      } else if (tab === 'ledger') {
        title.textContent = 'Expense Ledger';
        subtitle.textContent = 'Rohan\'s request: Transparent computation ledger';
        loadBalances();
      } else if (tab === 'members') {
        title.textContent = 'Flatmate Timeline';
        subtitle.textContent = 'Manage active membership durations';
        loadMembers();
      } else if (tab === 'importer') {
        title.textContent = 'Ingest Shared Spreadsheet';
        subtitle.textContent = 'Import CSV file and resolve anomalies';
      }
    });
  });

  // Theme button
  document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);

  // Group Select Change
  document.getElementById('groupSelect').addEventListener('change', (e) => {
    switchGroup(e.target.value);
  });

  // Modal controls
  const openModal = (id) => document.getElementById(id).classList.remove('hidden');
  const closeModal = (id) => document.getElementById(id).classList.add('hidden');

  document.getElementById('btnNewGroup').addEventListener('click', () => openModal('modalNewGroup'));
  document.getElementById('btnNewExpense').addEventListener('click', () => {
    setupExpenseModalForm();
    openModal('modalExpense');
  });

  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      closeModal('modalNewGroup');
      closeModal('modalExpense');
    });
  });

  // Sub tabs in expense modal (Expense vs Settlement)
  const expTab = document.getElementById('btnSubTabExpense');
  const payTab = document.getElementById('btnSubTabPayment');
  const splitSettings = document.getElementById('expenseSplitSettings');
  const paySettings = document.getElementById('paymentSettlementSettings');
  const isSettlementInput = document.createElement('input');
  isSettlementInput.type = 'hidden';
  isSettlementInput.id = 'expIsSettlement';
  isSettlementInput.value = '0';
  document.getElementById('formExpense').appendChild(isSettlementInput);

  expTab.addEventListener('click', () => {
    expTab.classList.add('active');
    payTab.classList.remove('active');
    splitSettings.classList.remove('hidden');
    paySettings.classList.add('hidden');
    isSettlementInput.value = '0';
    document.getElementById('currencyGroup').classList.remove('hidden');
    document.getElementById('expenseModalTitle').textContent = 'Add Expense';
  });

  payTab.addEventListener('click', () => {
    payTab.classList.add('active');
    expTab.classList.remove('active');
    splitSettings.classList.add('hidden');
    paySettings.classList.remove('hidden');
    isSettlementInput.value = '1';
    document.getElementById('currencyGroup').classList.add('hidden'); // default INR for payments
    document.getElementById('expenseModalTitle').textContent = 'Record Payment';
  });

  // Create Group Form Submit
  document.getElementById('btnSubmitGroup').addEventListener('click', async () => {
    const name = document.getElementById('inputGroupName').value.trim();
    if (!name) return alert('Name required');

    try {
      const res = await authFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const g = await res.json();
      closeModal('modalNewGroup');
      document.getElementById('inputGroupName').value = '';
      
      // Reload groups list, select new one
      await loadGroups();
      await switchGroup(g.id);
    } catch (err) {
      alert(`Error creating group: ${err.message}`);
    }
  });

  // Save Expense Form Submit
  document.getElementById('formExpense').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isSettlement = document.getElementById('expIsSettlement').value === '1';
    const description = document.getElementById('expDesc').value.trim();
    const date = document.getElementById('expDate').value;
    const paid_by = document.getElementById('expPayer').value;
    const amount = parseFloat(document.getElementById('expAmount').value);
    const notes = document.getElementById('expNotes').value.trim();

    let splits = [];
    let split_type = null;
    let split_with = '';
    let split_details = '';

    if (isSettlement) {
      // direct debt settlement
      const recipient = document.getElementById('expRecipient').value;
      if (paid_by === recipient) return alert('Cannot settle debt to yourself!');
      split_with = recipient;
      splits.push({ userId: recipient, owedAmount: amount });
    } else {
      split_type = document.getElementById('expSplitType').value;
      const currency = document.getElementById('expCurrency').value;
      
      // Calculate split amounts
      const checkedBoxes = document.querySelectorAll('.split-member-checkbox:checked');
      if (checkedBoxes.length === 0) return alert('Select at least one member to split with!');

      const participants = Array.from(checkedBoxes).map(cb => cb.value);
      split_with = participants.join(';');

      if (split_type === 'equal') {
        const val = amount / participants.length;
        participants.forEach(p => splits.push({ userId: p, owedAmount: val }));
      } 
      else {
        // Detailed splits: share, percentage, unequal
        let totalVal = 0;
        const detailsArr = [];
        participants.forEach(p => {
          const inp = document.querySelector(`.split-member-val-input[data-user="${p}"]`);
          const num = parseFloat(inp.value) || 0;
          totalVal += num;
          detailsArr.push(`${p} ${num}${split_type === 'percentage' ? '%' : ''}`);
        });
        
        split_details = detailsArr.join('; ');

        if (split_type === 'percentage' && Math.round(totalVal) !== 100) {
          return alert(`Percentages must sum to 100%! Current sum: ${totalVal}%`);
        }
        if (split_type === 'unequal' && Math.round(totalVal * 100) / 100 !== Math.round(amount * 100) / 100) {
          return alert(`Split sums (₹${totalVal}) must match the total expense amount (₹${amount})!`);
        }

        // Compute actual values to save
        if (split_type === 'percentage') {
          participants.forEach(p => {
            const pct = parseFloat(document.querySelector(`.split-member-val-input[data-user="${p}"]`).value) || 0;
            splits.push({ userId: p, owedAmount: (amount * pct) / 100 });
          });
        } else if (split_type === 'share') {
          participants.forEach(p => {
            const sh = parseFloat(document.querySelector(`.split-member-val-input[data-user="${p}"]`).value) || 0;
            splits.push({ userId: p, owedAmount: (amount * sh) / totalVal });
          });
        } else {
          participants.forEach(p => {
            const fixedAmt = parseFloat(document.querySelector(`.split-member-val-input[data-user="${p}"]`).value) || 0;
            splits.push({ userId: p, owedAmount: fixedAmt });
          });
        }
      }
    }

    try {
      const payload = {
        description,
        paid_by,
        amount,
        currency: isSettlement ? 'INR' : document.getElementById('expCurrency').value,
        original_amount: amount,
        exchange_rate: 1.0,
        split_type,
        date,
        notes,
        splits,
        is_settlement: isSettlement ? 1 : 0
      };

      const res = await authFetch(`/api/groups/${state.activeGroup}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      await res.json();
      closeModal('modalExpense');
      
      // Clear inputs
      document.getElementById('expDesc').value = '';
      document.getElementById('expAmount').value = '';
      document.getElementById('expNotes').value = '';

      // Reload balances
      await loadBalances();
    } catch (err) {
      alert(`Error saving expense: ${err.message}`);
    }
  });

  // Save/Update Membership timeline
  document.getElementById('formAddMember').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('memberUserId').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const joined_at = document.getElementById('memberJoinedAt').value;
    const left_at = document.getElementById('memberLeftAt').value || null;

    if (!userId || !joined_at) return alert('Name and Joined date required');

    try {
      const res = await authFetch(`/api/groups/${state.activeGroup}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, joined_at, left_at })
      });
      await res.json();
      
      // Clear
      document.getElementById('memberUserId').value = '';
      document.getElementById('memberJoinedAt').value = '';
      document.getElementById('memberLeftAt').value = '';

      // Reload
      await loadMembers();
      await loadBalances();
    } catch (err) {
      alert(`Error adding member: ${err.message}`);
    }
  });

  // Clear Ledger button
  document.getElementById('btnClearLedger').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete all expenses from this group? This cannot be undone.')) return;
    try {
      const res = await authFetch(`/api/groups/${state.activeGroup}/clear`, { method: 'POST' });
      await res.json();
      await loadBalances();
    } catch (err) {
      alert(`Error clearing ledger: ${err.message}`);
    }
  });

  // Login Submit
  document.getElementById('btnLoginSubmit').addEventListener('click', handleLogin);
  document.getElementById('btnLogout').addEventListener('click', handleLogout);

  // Drag & Drop CSV Event Handlers
  const dropArea = document.getElementById('dropArea');
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropArea.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropArea.classList.remove('drag-over');
    }, false);
  });

  dropArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      analyzeCSVFile(files[0]);
    }
  });

  document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      analyzeCSVFile(files[0]);
    }
  });

  // Cancel / Confirm import
  document.getElementById('btnCancelImport').addEventListener('click', () => {
    document.getElementById('uploaderContainer').classList.remove('hidden');
    document.getElementById('importerPreviewContainer').classList.add('hidden');
    document.getElementById('csvFileInput').value = '';
    state.previewRows = [];
  });

  document.getElementById('btnConfirmImport').addEventListener('click', executeConfirmImport);
  document.getElementById('btnCloseReport').addEventListener('click', () => {
    document.getElementById('importReportContainer').classList.add('hidden');
    document.getElementById('uploaderContainer').classList.remove('hidden');
    document.getElementById('csvFileInput').value = '';
    state.previewRows = [];
    
    // Switch to dashboard
    document.querySelector('[data-tab="dashboard"]').click();
  });

  // Onboarding Spotlight Tour listeners
  document.getElementById('btnOnboarding').addEventListener('click', () => startInteractiveTour());
  document.getElementById('btnTourPrev').addEventListener('click', () => prevTourStep());
  document.getElementById('btnTourNext').addEventListener('click', () => nextTourStep());
}

// --- Interactive Spotlight Tour Logic ---
let tourActiveStep = 0;
const tourSteps = [
  {
    target: '.group-selector-card',
    title: '🏠 Active Group Selector',
    text: 'Switch between different flat shared expense groups or create new groups (e.g. for a specific trip like "Goa Trip 2026") here.',
    tab: 'dashboard'
  },
  {
    target: '#settlementsList',
    title: '🔢 Aisha\'s Settlement Plan',
    text: 'Aisha wants "one number per person: who pays whom". This card displays the minimized payment list calculated by our optimizer.',
    tab: 'dashboard'
  },
  {
    target: '[data-tab="ledger"]',
    title: '📊 Rohan\'s Expense Ledger',
    text: 'Rohan wants "no magic numbers". This ledger displays every single line item split so you can audit exactly what you owe or are owed.',
    tab: 'ledger'
  },
  {
    target: '[data-tab="members"]',
    title: '📅 Sam & Meera\'s Timelines',
    text: 'Set joined and left dates for each member. Sam moved in mid-April and Meera left end-of-March. Splits are calculated based on these dates.',
    tab: 'members'
  },
  {
    target: '[data-tab="importer"]',
    title: '🧹 Meera\'s CSV Anomaly Log',
    text: 'Ingest your spreadsheet. The app parses the file and logs all duplicates, out-of-bound dates, and splits. Review and approve before importing.',
    tab: 'importer'
  }
];

function checkShowOnboarding() {
  const seenKey = `tour_seen_${state.currentUser}`;
  if (!localStorage.getItem(seenKey)) {
    startInteractiveTour();
  }
}

function startInteractiveTour() {
  tourActiveStep = 0;
  runTourStep(0);
}

function runTourStep(stepIdx) {
  // Clear any existing highlighted elements
  const prevHighlight = document.querySelector('.tour-highlighted');
  if (prevHighlight) {
    prevHighlight.classList.remove('tour-highlighted');
  }

  const step = tourSteps[stepIdx];
  
  // Switch to the correct tab if required
  if (step.tab) {
    const tabBtn = document.querySelector(`[data-tab="${step.tab}"]`);
    if (tabBtn && !tabBtn.classList.contains('active')) {
      tabBtn.click();
    }
  }

  // Wait a small timeout to let the tab change render
  setTimeout(() => {
    const el = document.querySelector(step.target);
    if (el) {
      el.classList.add('tour-highlighted');
      
      // Update Tooltip Contents
      document.getElementById('tourTooltipTitle').textContent = step.title;
      document.getElementById('tourTooltipText').textContent = step.text;
      document.getElementById('tourTooltipProgress').textContent = `${stepIdx + 1}/${tourSteps.length}`;
      
      const tooltip = document.getElementById('tourTooltip');
      tooltip.classList.remove('hidden');
      
      // Compute Position of Tooltip
      const rect = el.getBoundingClientRect();
      
      // Default position is to the right of the highlighted element
      let left = rect.right + 16 + window.scrollX;
      let top = rect.top + window.scrollY;
      
      // Adjust if off-screen
      if (left + 300 > window.innerWidth) {
        left = rect.left + window.scrollX;
        top = rect.bottom + 16 + window.scrollY;
      }
      
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      
      // Handle buttons state
      const prevBtn = document.getElementById('btnTourPrev');
      prevBtn.style.visibility = stepIdx === 0 ? 'hidden' : 'visible';
      
      const nextBtn = document.getElementById('btnTourNext');
      nextBtn.textContent = stepIdx === tourSteps.length - 1 ? 'Finish Tour' : 'Next';
    }
  }, 150);
}

function nextTourStep() {
  if (tourActiveStep === tourSteps.length - 1) {
    closeTour();
  } else {
    tourActiveStep++;
    runTourStep(tourActiveStep);
  }
}

function prevTourStep() {
  if (tourActiveStep > 0) {
    tourActiveStep--;
    runTourStep(tourActiveStep);
  }
}

function closeTour() {
  const prevHighlight = document.querySelector('.tour-highlighted');
  if (prevHighlight) {
    prevHighlight.classList.remove('tour-highlighted');
  }
  document.getElementById('tourTooltip').classList.add('hidden');
  localStorage.setItem(`tour_seen_${state.currentUser}`, 'true');
}
