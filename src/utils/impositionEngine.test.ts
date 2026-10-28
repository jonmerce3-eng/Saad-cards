import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleBusinessCardPdf,
  inspectUploadedPdf,
  generateImposedPdf,
} from './impositionEngine';

test('createSampleBusinessCardPdf creates a valid 2-page PDF of 95x60mm', async () => {
  const bytes = await createSampleBusinessCardPdf();
  assert.ok(bytes.length > 500);

  const inspected = await inspectUploadedPdf(bytes.buffer, 'sample.pdf');
  assert.equal(inspected.pageCount, 2);
  assert.equal(inspected.isExact95x60, true);
  assert.equal(inspected.status, 'exact_95x60');
  assert.equal(Math.round(inspected.widthMm), 95);
  assert.equal(Math.round(inspected.heightMm), 60);
});

test('generateImposedPdf produces proof and print PDFs with 5x5 layout', async () => {
  const sampleBytes = await createSampleBusinessCardPdf();
  const inspected = await inspectUploadedPdf(sampleBytes.buffer, 'sample.pdf');

  const proof = await generateImposedPdf(inspected.rawPdfDoc, {
    sheetType: '486x330',
    mode: 'cards_5x5',
    viewType: 'proof',
  });
  assert.ok(proof.pdfBytes.length > 1000);
  assert.equal(proof.fileName, 'CLIENT_PROOF_486x330.pdf');

  const print = await generateImposedPdf(inspected.rawPdfDoc, {
    sheetType: '486x330',
    mode: 'cards_5x5',
    viewType: 'print',
  });
  assert.ok(print.pdfBytes.length > 1000);
  assert.equal(print.fileName, 'PRINT_CMYK_486x330.pdf');
});
