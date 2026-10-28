import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHEET_CONFIGS,
  inspectPdfDimensions,
  calculateImpositionMargins,
} from './prepress';

test('inspectPdfDimensions identifies exact 95x60mm business card with bleed', () => {
  const exact = inspectPdfDimensions(95, 60);
  assert.equal(exact.sizeStatus, 'exact_95x60');
  assert.equal(exact.isExactCard, true);

  const withinTolerance = inspectPdfDimensions(95.1, 59.9);
  assert.equal(withinTolerance.sizeStatus, 'exact_95x60');
  assert.equal(withinTolerance.isExactCard, true);

  const nonStandard = inspectPdfDimensions(90, 55);
  assert.equal(nonStandard.sizeStatus, 'requires_choice');
  assert.equal(nonStandard.isExactCard, false);
});

test('calculateImpositionMargins computes 5x5 grid and margins for 486x330 and 500x350 sheets', () => {
  const stdSheet = calculateImpositionMargins(SHEET_CONFIGS['486x330']);
  assert.equal(stdSheet.totalCards, 25);
  assert.equal(stdSheet.gridWidthMm, 475);
  assert.equal(stdSheet.gridHeightMm, 300);
  assert.equal(stdSheet.marginXMm, 5.5);
  assert.equal(stdSheet.marginYMm, 15);

  const quarterSheet = calculateImpositionMargins(SHEET_CONFIGS['350x500']);
  assert.equal(quarterSheet.totalCards, 25);
  assert.equal(quarterSheet.gridWidthMm, 475);
  assert.equal(quarterSheet.gridHeightMm, 300);
  assert.equal(quarterSheet.marginXMm, 12.5);
  assert.equal(quarterSheet.marginYMm, 25);
});
