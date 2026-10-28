import { PDFDocument, rgb, cmyk } from 'pdf-lib';
import { SheetConfig, SHEET_CONFIGS } from './prepress';

const MM_TO_PT = 72 / 25.4;
const PT_TO_MM = 25.4 / 72;

export interface PdfInspectionResult {
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  widthPt: number;
  heightPt: number;
  widthMm: number;
  heightMm: number;
  isExact95x60: boolean;
  status: 'exact_95x60' | 'custom_size';
  rawPdfDoc: PDFDocument;
}

export async function inspectUploadedPdf(
  file: File | ArrayBuffer,
  fileName = 'file.pdf'
): Promise<PdfInspectionResult> {
  const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file;
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pageCount = pdfDoc.getPageCount();
  const firstPage = pdfDoc.getPage(0);
  const { width, height } = firstPage.getSize();

  const widthMm = Number((width * PT_TO_MM).toFixed(1));
  const heightMm = Number((height * PT_TO_MM).toFixed(1));

  // Check 95x60 with 0.5mm tolerance
  const isExact95x60 =
    Math.abs(widthMm - 95) <= 0.6 && Math.abs(heightMm - 60) <= 0.6;

  return {
    fileName,
    fileSizeBytes: arrayBuffer.byteLength,
    pageCount,
    widthPt: width,
    heightPt: height,
    widthMm,
    heightMm,
    isExact95x60,
    status: isExact95x60 ? 'exact_95x60' : 'custom_size',
    rawPdfDoc: pdfDoc,
  };
}

export interface ImpositionOptions {
  sheetType: '486x330' | '350x500';
  mode: 'cards_5x5' | 'center_sheet';
  viewType: 'proof' | 'print';
}

export async function generateImposedPdf(
  sourcePdfDoc: PDFDocument,
  options: ImpositionOptions
): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  const targetDoc = await PDFDocument.create();
  const sheetConfig = SHEET_CONFIGS[options.sheetType];
  const sheetWidthPt = sheetConfig.widthMm * MM_TO_PT;
  const sheetHeightPt = sheetConfig.heightMm * MM_TO_PT;

  const cardWidthPt = 95 * MM_TO_PT;
  const cardHeightPt = 60 * MM_TO_PT;
  const cols = 5;
  const rows = 5;
  const gridWidthPt = cols * cardWidthPt;
  const gridHeightPt = rows * cardHeightPt;

  // Center grid on sheet
  const startX = (sheetWidthPt - gridWidthPt) / 2;
  const startY = (sheetHeightPt - gridHeightPt) / 2;

  const markLenPt = 5 * MM_TO_PT; // 5 mm length
  const markOffsetPt = 3 * MM_TO_PT; // 3 mm offset from design edge

  // Colors: Proof = Cyan, Print = Registration (100% CMYK)
  const markColor =
    options.viewType === 'proof'
      ? cmyk(1, 0, 0, 0) // 100% Cyan
      : cmyk(1, 1, 1, 1); // 100% C, 100% M, 100% Y, 100% K Registration

  const markThickness = 0.5; // Hairline

  const pageCount = sourcePdfDoc.getPageCount();
  const pagesToImpose = Math.min(pageCount, 2); // Front and optional Back

  for (let pageIdx = 0; pageIdx < pagesToImpose; pageIdx++) {
    const sheetPage = targetDoc.addPage([sheetWidthPt, sheetHeightPt]);
    const embeddedCard = await targetDoc.embedPage(sourcePdfDoc.getPage(pageIdx));

    if (options.mode === 'cards_5x5') {
      // Draw 25 cards
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // If back page, mirror columns horizontally so back aligns with front after flip
          const effectiveCol = pageIdx === 1 ? cols - 1 - c : c;
          const x = startX + effectiveCol * cardWidthPt;
          const y = startY + (rows - 1 - r) * cardHeightPt;

          sheetPage.drawPage(embeddedCard, {
            x,
            y,
            width: cardWidthPt,
            height: cardHeightPt,
          });
        }
      }

      // Draw External Crop Marks (Trim lines are at 2.5mm inside each 95x60 card)
      const bleedPt = 2.5 * MM_TO_PT;

      // Draw vertical marks along top and bottom edges for each column's trim lines
      for (let c = 0; c < cols; c++) {
        const cardLeft = startX + c * cardWidthPt;
        const trimLeft = cardLeft + bleedPt;
        const trimRight = cardLeft + cardWidthPt - bleedPt;

        // Top edge marks (pointing upward)
        sheetPage.drawLine({
          start: { x: trimLeft, y: startY + gridHeightPt + markOffsetPt },
          end: { x: trimLeft, y: startY + gridHeightPt + markOffsetPt + markLenPt },
          thickness: markThickness,
          color: markColor,
        });
        sheetPage.drawLine({
          start: { x: trimRight, y: startY + gridHeightPt + markOffsetPt },
          end: { x: trimRight, y: startY + gridHeightPt + markOffsetPt + markLenPt },
          thickness: markThickness,
          color: markColor,
        });

        // Bottom edge marks (pointing downward)
        sheetPage.drawLine({
          start: { x: trimLeft, y: startY - markOffsetPt },
          end: { x: trimLeft, y: startY - markOffsetPt - markLenPt },
          thickness: markThickness,
          color: markColor,
        });
        sheetPage.drawLine({
          start: { x: trimRight, y: startY - markOffsetPt },
          end: { x: trimRight, y: startY - markOffsetPt - markLenPt },
          thickness: markThickness,
          color: markColor,
        });
      }

      // Draw horizontal marks along left and right edges for each row's trim lines
      for (let r = 0; r < rows; r++) {
        const cardBottom = startY + r * cardHeightPt;
        const trimBottom = cardBottom + bleedPt;
        const trimTop = cardBottom + cardHeightPt - bleedPt;

        // Left edge marks (pointing left)
        sheetPage.drawLine({
          start: { x: startX - markOffsetPt, y: trimBottom },
          end: { x: startX - markOffsetPt - markLenPt, y: trimBottom },
          thickness: markThickness,
          color: markColor,
        });
        sheetPage.drawLine({
          start: { x: startX - markOffsetPt, y: trimTop },
          end: { x: startX - markOffsetPt - markLenPt, y: trimTop },
          thickness: markThickness,
          color: markColor,
        });

        // Right edge marks (pointing right)
        sheetPage.drawLine({
          start: { x: startX + gridWidthPt + markOffsetPt, y: trimBottom },
          end: { x: startX + gridWidthPt + markOffsetPt + markLenPt, y: trimBottom },
          thickness: markThickness,
          color: markColor,
        });
        sheetPage.drawLine({
          start: { x: startX + gridWidthPt + markOffsetPt, y: trimTop },
          end: { x: startX + gridWidthPt + markOffsetPt + markLenPt, y: trimTop },
          thickness: markThickness,
          color: markColor,
        });
      }
    } else {
      // Center single artwork on sheet
      const { width: srcW, height: srcH } = sourcePdfDoc.getPage(pageIdx).getSize();
      const cx = (sheetWidthPt - srcW) / 2;
      const cy = (sheetHeightPt - srcH) / 2;

      sheetPage.drawPage(embeddedCard, {
        x: cx,
        y: cy,
        width: srcW,
        height: srcH,
      });
    }

    // Sheet Info Label outside printable area in standard ASCII
    const sheetLabel = options.sheetType === '486x330' ? '486x330mm Sheet' : '500x350mm Sheet';
    sheetPage.drawText(
      `Job: ${options.viewType === 'proof' ? 'CLIENT PROOF (CYAN)' : 'PRINT CMYK (REGISTRATION)'} | Sheet: ${sheetLabel} | Page ${pageIdx + 1}/${pagesToImpose}`,
      {
        x: 20,
        y: sheetHeightPt - 20,
        size: 8,
        color: markColor,
      }
    );
  }

  const pdfBytes = await targetDoc.save();
  const prefix = options.viewType === 'proof' ? 'CLIENT_PROOF' : 'PRINT_CMYK';
  const fileName = `${prefix}_${options.sheetType}.pdf`;

  return { pdfBytes, fileName };
}

/**
 * Creates a demo sample 95x60mm business card PDF on the fly for testing
 */
export async function createSampleBusinessCardPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const widthPt = 95 * MM_TO_PT;
  const heightPt = 60 * MM_TO_PT;

  // Front Page
  const page1 = doc.addPage([widthPt, heightPt]);
  page1.drawRectangle({
    x: 0,
    y: 0,
    width: widthPt,
    height: heightPt,
    color: rgb(0.08, 0.12, 0.18),
  });
  // Inner trim area preview
  page1.drawRectangle({
    x: 2.5 * MM_TO_PT,
    y: 2.5 * MM_TO_PT,
    width: 90 * MM_TO_PT,
    height: 55 * MM_TO_PT,
    borderColor: rgb(0.2, 0.4, 0.6),
    borderWidth: 1,
  });
  page1.drawText('PREPRESS AUTOMATION', {
    x: 10 * MM_TO_PT,
    y: 35 * MM_TO_PT,
    size: 13,
    color: rgb(0.2, 0.8, 1),
  });
  page1.drawText('Business Card (95x60mm with 2.5mm Bleed)', {
    x: 10 * MM_TO_PT,
    y: 24 * MM_TO_PT,
    size: 8,
    color: rgb(0.8, 0.9, 1),
  });

  // Back Page
  const page2 = doc.addPage([widthPt, heightPt]);
  page2.drawRectangle({
    x: 0,
    y: 0,
    width: widthPt,
    height: heightPt,
    color: rgb(0.05, 0.08, 0.12),
  });
  page2.drawText('CARD BACK (95x60 mm)', {
    x: 15 * MM_TO_PT,
    y: 30 * MM_TO_PT,
    size: 12,
    color: rgb(0.9, 0.9, 0.9),
  });

  return await doc.save();
}
