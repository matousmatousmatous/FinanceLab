'use strict';

// sandbox.js uses a UMD wrapper — in Node.js it exports via module.exports
const { TEMPLATE_ANSWERS, checkCell } = require('../sandbox');

// ─── checkCell() — Income Statement ───────────────────────────────────────────

describe('checkCell() — Income Statement (is)', () => {
  test('gross_profit 200 → correct', () => expect(checkCell('is', 'gross_profit', 200)).toBe(true));
  test('gross_profit 100 → wrong',   () => expect(checkCell('is', 'gross_profit', 100)).toBe(false));
  test('gross_profit 200.5 → correct (within 0.5% tolerance)', () => expect(checkCell('is', 'gross_profit', 200.5)).toBe(true));
  test('gross_profit "200" (string) → correct', () => expect(checkCell('is', 'gross_profit', '200')).toBe(true));
  test('ebitda 200 → correct',       () => expect(checkCell('is', 'ebitda', 200)).toBe(true));
  test('ebit 160 → correct',         () => expect(checkCell('is', 'ebit', 160)).toBe(true));
  test('ebt 145 → correct',          () => expect(checkCell('is', 'ebt', 145)).toBe(true));
  test('tax 36.25 → correct',        () => expect(checkCell('is', 'tax', 36.25)).toBe(true));
  test('net_income 108.75 → correct',() => expect(checkCell('is', 'net_income', 108.75)).toBe(true));
  test('gross_margin_pct 40 → correct',  () => expect(checkCell('is', 'gross_margin_pct', 40)).toBe(true));
  test('net_margin_pct 21.75 → correct', () => expect(checkCell('is', 'net_margin_pct', 21.75)).toBe(true));
});

// ─── checkCell() — Balance Sheet ──────────────────────────────────────────────

describe('checkCell() — Balance Sheet (bs)', () => {
  test('total_current_assets 250 → correct',     () => expect(checkCell('bs', 'total_current_assets', 250)).toBe(true));
  test('total_noncurrent_assets 500 → correct',  () => expect(checkCell('bs', 'total_noncurrent_assets', 500)).toBe(true));
  test('total_assets 750 → correct',             () => expect(checkCell('bs', 'total_assets', 750)).toBe(true));
  test('total_current_liabilities 150 → correct',() => expect(checkCell('bs', 'total_current_liabilities', 150)).toBe(true));
  test('total_equity 400 → correct',             () => expect(checkCell('bs', 'total_equity', 400)).toBe(true));
  test('total_liabilities_equity 750 → correct', () => expect(checkCell('bs', 'total_liabilities_equity', 750)).toBe(true));
  test('working_capital 100 → correct',          () => expect(checkCell('bs', 'working_capital', 100)).toBe(true));
  test('current_ratio 1.67 → correct',           () => expect(checkCell('bs', 'current_ratio', 1.67)).toBe(true));
  test('debt_equity_ratio 0.65 → correct',       () => expect(checkCell('bs', 'debt_equity_ratio', 0.65)).toBe(true));
  test('total_assets 800 → wrong',               () => expect(checkCell('bs', 'total_assets', 800)).toBe(false));
});

// ─── checkCell() — Cash Flow Statement ────────────────────────────────────────

describe('checkCell() — Cash Flow Statement (cf)', () => {
  test('delta_ar -20 → correct',    () => expect(checkCell('cf', 'delta_ar', -20)).toBe(true));
  test('delta_inventory -10 → correct', () => expect(checkCell('cf', 'delta_inventory', -10)).toBe(true));
  test('delta_ap 15 → correct',     () => expect(checkCell('cf', 'delta_ap', 15)).toBe(true));
  test('cfo 145 → correct',         () => expect(checkCell('cf', 'cfo', 145)).toBe(true));
  test('cfi -80 → correct',         () => expect(checkCell('cf', 'cfi', -80)).toBe(true));
  test('cff -20 → correct',         () => expect(checkCell('cf', 'cff', -20)).toBe(true));
  test('net_change 45 → correct',   () => expect(checkCell('cf', 'net_change', 45)).toBe(true));
  test('ending_cash 95 → correct',  () => expect(checkCell('cf', 'ending_cash', 95)).toBe(true));
  test('cfo 100 → wrong',           () => expect(checkCell('cf', 'cfo', 100)).toBe(false));
});

// ─── checkCell() — DCF Model ──────────────────────────────────────────────────

describe('checkCell() — DCF Model (dcf)', () => {
  test('ebitda_1 40 → correct',            () => expect(checkCell('dcf', 'ebitda_1', 40)).toBe(true));
  test('ebit_1 30 → correct',              () => expect(checkCell('dcf', 'ebit_1', 30)).toBe(true));
  test('nopat_1 22.5 → correct',           () => expect(checkCell('dcf', 'nopat_1', 22.5)).toBe(true));
  test('fcff_1 15.5 → correct',            () => expect(checkCell('dcf', 'fcff_1', 15.5)).toBe(true));
  test('pv_fcff_1 14.09 → correct',        () => expect(checkCell('dcf', 'pv_fcff_1', 14.09)).toBe(true));
  test('sum_pv_fcf 79.25 → correct',       () => expect(checkCell('dcf', 'sum_pv_fcf', 79.25)).toBe(true));
  test('terminal_value 386.77 → correct',  () => expect(checkCell('dcf', 'terminal_value', 386.77)).toBe(true));
  test('pv_tv 240.15 → correct',           () => expect(checkCell('dcf', 'pv_tv', 240.15)).toBe(true));
  test('enterprise_value 319.40 → correct',() => expect(checkCell('dcf', 'enterprise_value', 319.40)).toBe(true));
  test('ev_ebitda_multiple 7.99 → correct',() => expect(checkCell('dcf', 'ev_ebitda_multiple', 7.99)).toBe(true));
});

// ─── checkCell() — Edge cases ─────────────────────────────────────────────────

describe('checkCell() — edge cases', () => {
  test('returns null for unknown templateId', () => {
    expect(checkCell('unknown', 'gross_profit', 200)).toBeNull();
  });

  test('returns null for unknown cellKey', () => {
    expect(checkCell('is', 'nonexistent_key', 200)).toBeNull();
  });

  test('returns false for non-numeric input', () => {
    expect(checkCell('is', 'gross_profit', 'not-a-number')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(checkCell('is', 'gross_profit', '')).toBe(false);
  });

  test('tolerance: value just within 0.5% → correct', () => {
    const correct = TEMPLATE_ANSWERS.is.gross_profit; // 200
    const within = correct * 1.0049; // 0.49% over
    expect(checkCell('is', 'gross_profit', within)).toBe(true);
  });

  test('tolerance: value just outside 0.5% → wrong', () => {
    const correct = TEMPLATE_ANSWERS.is.gross_profit; // 200
    const outside = correct * 1.0051; // 0.51% over
    expect(checkCell('is', 'gross_profit', outside)).toBe(false);
  });

  test('comma-formatted number "1,000" is parsed correctly', () => {
    // gross_profit is 200 — "1,000" should be wrong
    expect(checkCell('is', 'gross_profit', '1,000')).toBe(false);
  });
});
