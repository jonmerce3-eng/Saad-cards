export interface SheetConfig {
  id: '486x330' | '350x500';
  name: string;
  widthMm: number;
  heightMm: number;
  cols: number;
  rows: number;
  cardWidthMm: number; // 95
  cardHeightMm: number; // 60
  trimWidthMm: number; // 90
  trimHeightMm: number; // 55
  bleedMm: number; // 2.5
  cropMarkLengthMm: number; // 5
  cropMarkOffsetMm: number; // 3
}

export const SHEET_CONFIGS: Record<'486x330' | '350x500', SheetConfig> = {
  '486x330': {
    id: '486x330',
    name: 'فرخ قياسي (48.6 × 33.0 سم)',
    widthMm: 486,
    heightMm: 330,
    cols: 5,
    rows: 5,
    cardWidthMm: 95,
    cardHeightMm: 60,
    trimWidthMm: 90,
    trimHeightMm: 55,
    bleedMm: 2.5,
    cropMarkLengthMm: 5,
    cropMarkOffsetMm: 3,
  },
  '350x500': {
    id: '350x500',
    name: 'فرخ ربع (50.0 × 35.0 سم)',
    widthMm: 500,
    heightMm: 350,
    cols: 5,
    rows: 5,
    cardWidthMm: 95,
    cardHeightMm: 60,
    trimWidthMm: 90,
    trimHeightMm: 55,
    bleedMm: 2.5,
    cropMarkLengthMm: 5,
    cropMarkOffsetMm: 3,
  },
};

export function inspectPdfDimensions(widthMm: number, heightMm: number, toleranceMm = 0.2): {
  sizeStatus: 'exact_95x60' | 'requires_choice';
  isExactCard: boolean;
  blockWidthMm: number;
  blockHeightMm: number;
} {
  const isExactStandard =
    Math.abs(widthMm - 95) <= toleranceMm && Math.abs(heightMm - 60) <= toleranceMm;
  return {
    sizeStatus: isExactStandard ? 'exact_95x60' : 'requires_choice',
    isExactCard: isExactStandard,
    blockWidthMm: 95 * 5,
    blockHeightMm: 60 * 5,
  };
}

export function calculateImpositionMargins(sheet: SheetConfig): {
  totalCards: number;
  gridWidthMm: number;
  gridHeightMm: number;
  marginXMm: number;
  marginYMm: number;
} {
  const gridWidthMm = sheet.cols * sheet.cardWidthMm;
  const gridHeightMm = sheet.rows * sheet.cardHeightMm;
  const marginXMm = Number(((sheet.widthMm - gridWidthMm) / 2).toFixed(2));
  const marginYMm = Number(((sheet.heightMm - gridHeightMm) / 2).toFixed(2));

  return {
    totalCards: sheet.cols * sheet.rows,
    gridWidthMm,
    gridHeightMm,
    marginXMm,
    marginYMm,
  };
}
