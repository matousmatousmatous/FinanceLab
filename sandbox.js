/* sandbox.js — Modelling Sandbox template data and validation.
 * Works in both browser (sets window.SandboxModule) and Node.js (module.exports).
 *
 * All monetary figures are in €M unless stated.
 * Tolerance for correct answers: ±0.5% (minimum ±0.01 for near-zero values).
 */
(function (global) {
  'use strict';

  // ─── Template answer keys ──────────────────────────────────────────────────
  // Each key maps to the exact numerical correct answer.

  const TEMPLATE_ANSWERS = {

    // ── Template 1: Income Statement ────────────────────────────────────────
    // Given: Revenue 500, COGS 300, D&A 40, Interest 15, Tax Rate 25%
    is: {
      gross_profit:      200,       // 500 − 300
      ebitda:            200,       // Gross Profit (no other opex in this simplified IS)
      ebit:              160,       // EBITDA − D&A (200 − 40)
      ebt:               145,       // EBIT − Interest (160 − 15)
      tax:               36.25,     // EBT × 25%
      net_income:        108.75,    // EBT − Tax
      gross_margin_pct:  40,        // Gross Profit / Revenue × 100
      ebitda_margin_pct: 40,        // EBITDA / Revenue × 100
      net_margin_pct:    21.75,     // Net Income / Revenue × 100
    },

    // ── Template 2: Balance Sheet ─────────────────────────────────────────
    // Acme Corp, Year 1
    // Given: Cash 50, AR 80, Inventory 120, PP&E 400, Intangibles 100,
    //        AP 90, ST Debt 60, LT Debt 200, Common Stock 150, Retained Earnings 250
    bs: {
      total_current_assets:     250,  // 50+80+120
      total_noncurrent_assets:  500,  // 400+100
      total_assets:             750,  // 250+500
      total_current_liabilities:150,  // 90+60
      total_equity:             400,  // 150+250
      total_liabilities_equity: 750,  // check: TL(350)+TE(400)
      working_capital:          100,  // TCA − TCL (250−150)
      current_ratio:            1.67, // TCA/TCL (250/150, rounded 2dp)
      debt_equity_ratio:        0.65, // (STDebt+LTDebt)/TE (260/400)
    },

    // ── Template 3: Cash Flow Statement (Indirect Method) ─────────────────
    // Given: Net Income 120, D&A 40, CapEx 80, Beginning Cash 50,
    //        ΔAR +20, ΔInventory +10, ΔAP +15, Debt Issued 30, Dividends 50
    cf: {
      // Operating section
      delta_ar:          -20,   // increase in AR = cash outflow
      delta_inventory:   -10,   // increase in inventory = cash outflow
      delta_ap:           15,   // increase in AP = cash inflow
      cfo:               145,   // 120+40−20−10+15
      // Investing section
      cfi:               -80,   // CapEx only
      // Financing section
      cff:               -20,   // Debt(+30) − Dividends(−50)
      net_change:         45,   // CFO+CFI+CFF (145−80−20)
      ending_cash:        95,   // Beginning(50) + Net Change(45)
    },

    // ── Template 4: DCF Model ─────────────────────────────────────────────
    // Given per year: Revenue 100,110,121,133,146 | EBITDA Margin 40%
    // D&A 10 | CapEx 15 | ΔNWC 2,2,3,3,3 | Tax 25% | WACC 10% | TGR 2.5%
    dcf: {
      // Year 1
      ebitda_1:   40,    // 100×40%
      ebit_1:     30,    // 40−10
      nopat_1:    22.5,  // 30×75%
      fcff_1:     15.5,  // 22.5+10−15−2
      pv_fcff_1:  14.09, // 15.5/1.10
      // Year 2
      ebitda_2:   44,
      ebit_2:     34,
      nopat_2:    25.5,
      fcff_2:     18.5,
      pv_fcff_2:  15.29, // 18.5/1.21
      // Year 3
      ebitda_3:   48.4,
      ebit_3:     38.4,
      nopat_3:    28.8,
      fcff_3:     20.8,
      pv_fcff_3:  15.63, // 20.8/1.331
      // Year 4
      ebitda_4:   53.2,
      ebit_4:     43.2,
      nopat_4:    32.4,
      fcff_4:     24.4,
      pv_fcff_4:  16.67, // 24.4/1.4641
      // Year 5
      ebitda_5:   58.4,
      ebit_5:     48.4,
      nopat_5:    36.3,
      fcff_5:     28.3,
      pv_fcff_5:  17.57, // 28.3/1.61051
      // Aggregates
      sum_pv_fcf: 79.25,  // sum of 5 PV FCFs
      terminal_value: 386.77, // FCFF5×1.025/0.075
      pv_tv:      240.15, // TV/1.61051
      enterprise_value: 319.40, // sum_pv_fcf + pv_tv
      ev_ebitda_multiple: 7.99, // EV / EBITDA_1
    },
  };

  // ─── Given / pre-filled values (not editable) ─────────────────────────────

  const TEMPLATE_GIVEN = {
    is: {
      revenue: 500, cogs: 300, da: 40, interest_expense: 15, tax_rate_pct: 25,
    },
    bs: {
      cash: 50, ar: 80, inventory: 120, ppe_net: 400, intangibles: 100,
      ap: 90, st_debt: 60, lt_debt: 200, common_stock: 150, retained_earnings: 250,
    },
    cf: {
      net_income: 120, da: 40, capex: 80, beginning_cash: 50,
      delta_ar_raw: 20, delta_inventory_raw: 10, delta_ap_raw: 15,
      debt_issued: 30, dividends_paid: 50,
    },
    dcf: {
      revenue_1: 100, revenue_2: 110, revenue_3: 121, revenue_4: 133, revenue_5: 146,
      ebitda_margin_pct: 40, da: 10, capex: 15,
      dnwc_1: 2, dnwc_2: 2, dnwc_3: 3, dnwc_4: 3, dnwc_5: 3,
      tax_rate_pct: 25, wacc_pct: 10, tgr_pct: 2.5,
    },
  };

  // ─── Validation ───────────────────────────────────────────────────────────

  /**
   * Check whether `userValue` is within ±0.5% of the correct answer.
   * Returns true (correct), false (wrong), or null (unknown cell).
   *
   * @param {string} templateId  - 'is' | 'bs' | 'cf' | 'dcf'
   * @param {string} cellKey     - key matching TEMPLATE_ANSWERS[templateId]
   * @param {string|number} userValue
   * @returns {boolean|null}
   */
  function checkCell(templateId, cellKey, userValue) {
    const answers = TEMPLATE_ANSWERS[templateId];
    if (!answers || !(cellKey in answers)) return null;

    const correct = answers[cellKey];
    const user    = parseFloat(String(userValue).replace(/,/g, ''));
    if (isNaN(user)) return false;

    const tolerance = Math.max(Math.abs(correct) * 0.005, 0.01);
    return Math.abs(user - correct) <= tolerance;
  }

  // ─── Metadata for UI rendering ────────────────────────────────────────────

  const TEMPLATE_META = {
    is: {
      id: 'is', title: 'Income Statement', difficulty: 'Beginner',
      relates: 'Harrison Ch.3 — Accrual Accounting',
    },
    bs: {
      id: 'bs', title: 'Balance Sheet', difficulty: 'Intermediate',
      relates: 'Harrison Ch.4 — Financial Position',
    },
    cf: {
      id: 'cf', title: 'Cash Flow Statement', difficulty: 'Advanced',
      relates: 'Harrison Ch.11 — Cash Flows (Indirect Method)',
    },
    dcf: {
      id: 'dcf', title: 'DCF Model', difficulty: 'Advanced',
      relates: 'Brealey Ch.2 — Present Values & Ch.9 — Capital Budgeting',
    },
  };

  // ─── Export ───────────────────────────────────────────────────────────────

  const SandboxModule = { TEMPLATE_ANSWERS, TEMPLATE_GIVEN, TEMPLATE_META, checkCell };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SandboxModule;
  } else {
    global.SandboxModule = SandboxModule;
  }

}(typeof globalThis !== 'undefined' ? globalThis : this));
