# AI Usage Log (AI_USAGE.md)

This log documents the collaboration with the AI assistant (**Antigravity** by Google DeepMind) to build the Shared Expenses Application.

---

## 1. AI Tools Used & Prompts
* **Primary AI Assistant**: Antigravity (Gemini 3.5 Flash).
* **Key Guidelines & Prompts**:
  - Focus on robust, clean, and self-contained designs.
  - Implement full relational integrity using SQLite3.
  - Perform dry-run parsing to capture and display anomalies interactively before importing.
  - Implement automated test suites to enforce business logic.

---

## 2. Concrete Cases of AI Errors & Resolutions

During development, three significant logical errors occurred in the AI's generated code. Below is an explanation of each issue, how we caught it, and how it was fixed.

### Case 1: Inadequate Duplicate Description Matcher
* **What the AI did wrong**: The initial implementation of `isDescriptionSimilar` used a basic alphanumeric string check:
  ```js
  const d1 = desc1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const d2 = desc2.toLowerCase().replace(/[^a-z0-9]/g, '');
  return d1 === d2 || d1.includes(d2) || d2.includes(d1);
  ```
  This failed to match "Dinner at Marina Bites" with "dinner - marina bites" because of the stop word "at", and failed to match "Dinner at Thalassa" with "Thalassa dinner" due to word ordering.
* **How we caught it**: The automated integration test failed with:
  `TEST FAILURE: Error: FAILED to detect DUPLICATE_ENTRY on Row 6`.
* **What we changed**: We refactored the similarity matcher to use a **word-set intersection algorithm** that filters out common English stop words (like `at`, `for`, `the`) and checks for word-overlap. If $\ge$ 75% of the words match, it is flagged as a duplicate/double-entry. This resolved the issue and passed all tests.

---

### Case 2: Payer Normalization Precedence Bug
* **What the AI did wrong**: The AI implemented name prefix checks sequentially in the `normalizeName` function:
  ```js
  if (clean.startsWith('dev')) return 'dev';
  if (clean.includes('kabir')) return 'kabir';
  ```
  Because `"dev's friend kabir"` starts with the prefix `"dev"`, the function immediately returned `"dev"` and never reached the `"kabir"` check.
* **How we caught it**: The integration test failed with:
  `TEST FAILURE: Error: FAILED to detect EXTRANEOUS_MEMBER on Row 23`.
* **What we changed**: We adjusted the precedence in `normalizeName` to check for `"kabir"` first before checking starts-with prefixes. This correctly normalized `"Dev's friend Kabir"` to `"kabir"` and allowed the anomaly engine to flag the extraneous user.

---

### Case 3: Floating Point Precision Remainder Leaks
* **What the AI did wrong**: In the initial draft of the equal split calculator, the AI divided the amount by the number of participants using basic division:
  ```js
  const shareVal = amount / participants.length;
  // then assigned shareVal directly to all participants
  ```
  For fractional values (like dividing ₹1199 by 4, which is 299.75, or dividing ₹899.995 by 4), this led to small rounding leaks. Summing up all balances resulted in a non-zero net balance (e.g. $+0.02$ or $-0.01$), violating the double-entry ledger principle.
* **How we caught it**: Code review of the balance sum assertion in `test_import.js` caught that the sum of balances was non-zero.
* **What we changed**: We updated the equal, share, and percentage split logic to round each share to 2 decimal places, keep a running total of the allocated amounts, and assign the mathematical remainder (if any) to the last participant:
  ```js
  const shareVal = Math.round((finalAmount / participants.length) * 100) / 100;
  let sum = 0;
  for (let idx = 0; idx < participants.length; idx++) {
    const p = participants[idx];
    if (idx === participants.length - 1) {
      calculatedSplits[p] = Math.round((finalAmount - sum) * 100) / 100; // remainder goes to last member
    } else {
      calculatedSplits[p] = shareVal;
      sum += shareVal;
    }
  }
  ```
  This guarantees that the sum of splits matches the total amount, and the sum of all flatmate net balances is exactly `0.00`.
