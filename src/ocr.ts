import type { OcrResultItem, OcrRuntimeParamsInput } from "@paddleocr/paddleocr-js";
import { createEmptyGrid } from "./sudoku";
import type { RecognitionResult, SudokuGrid } from "./types";

type ProgressCallback = (message: string, progress?: number) => void;

type PaddleOcrEngine = {
  predict(input: unknown, params?: OcrRuntimeParamsInput): Promise<Array<{ items: OcrResultItem[] }>>;
  dispose(): Promise<void>;
};

type DigitCandidate = {
  digit: number | null;
  confidence: number;
  votes?: number;
};

type CellCandidate = {
  row: number;
  col: number;
  digit: number;
  confidence: number;
};

type GridGeometry = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cellWidth: number;
  cellHeight: number;
};

const CELL_COUNT = 9;
const BOARD_ACCEPT_CONFIDENCE = 18;
const OCR_ACCEPT_CONFIDENCE = 42;
const MIN_INK_RATIO = 0.004;
const ORT_WASM_PATHS =
  import.meta.env.MODE === "development"
    ? "/node_modules/onnxruntime-web/dist/"
    : new URL("ort/", window.location.href).href;

let paddleOcrPromise: Promise<PaddleOcrEngine> | null = null;

export async function recognizeSudokuFromImage(file: File, onProgress?: ProgressCallback): Promise<RecognitionResult> {
  const sourceImageUrl = URL.createObjectURL(file);
  const image = await loadImage(sourceImageUrl);
  const imageCanvas = drawImageToCanvas(image);
  const square = cropCenterSquare(imageCanvas);
  const geometry = detectGridGeometry(square);
  const grid: SudokuGrid = createEmptyGrid();
  const confidence = createEmptyGrid().map((row) => row.map(() => 0));
  const warnings: string[] = [];

  try {
    onProgress?.("正在加载 PaddleOCR 模型", 0.08);
    const ocr = await getPaddleOcr();

    onProgress?.("正在整板识别", 0.16);
    applyCandidates(grid, confidence, await recognizeBoard(square, geometry, ocr));

    if (grid.flat().filter(Boolean).length < 24) {
      onProgress?.("正在逐格补识别", 0.28);
      await recognizeCells(square, geometry, ocr, grid, confidence, onProgress);
    }

    removeDuplicateConflicts(grid, confidence);
  } catch (error) {
    await resetPaddleOcr();
    throw new Error(error instanceof Error ? `OCR 模型加载或识别失败：${error.message}` : "OCR 模型加载或识别失败");
  }

  const filled = grid.flat().filter(Boolean).length;
  if (filled === 0) {
    warnings.push("没有识别到数字，请在棋盘里手动录入题目。");
  } else if (filled < 17) {
    warnings.push("识别到的数字偏少，建议对照原图补齐后再求解。");
  } else {
    warnings.push("已按检测到的棋盘边界回填位置，并自动清理明显重复冲突的低置信数字。");
  }
  warnings.push("黄色格代表低置信度，红色格代表仍需手动处理的冲突。");

  return { grid, confidence, sourceImageUrl, warnings };
}

async function getPaddleOcr(): Promise<PaddleOcrEngine> {
  if (!paddleOcrPromise) {
    const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
    paddleOcrPromise = PaddleOCR.create({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: 8,
      ortOptions: {
        backend: "wasm",
        wasmPaths: ORT_WASM_PATHS,
        numThreads: 1,
        simd: true
      }
    });
  }

  return paddleOcrPromise;
}

async function resetPaddleOcr() {
  const current = paddleOcrPromise;
  paddleOcrPromise = null;

  if (!current) return;
  try {
    const ocr = await current;
    await ocr.dispose();
  } catch {
    // If initialization failed, there may be no runtime to dispose.
  }
}

async function recognizeBoard(square: HTMLCanvasElement, geometry: GridGeometry, ocr: PaddleOcrEngine): Promise<CellCandidate[]> {
  const cleanBoard = eraseGridLines(preprocessCanvas(square, 150), geometry);
  const [result] = await ocr.predict(cleanBoard, {
    textDetLimitType: "max",
    textDetLimitSideLen: 960,
    textDetBoxThresh: 0.08,
    textRecScoreThresh: 0.05
  });

  return mapOcrItemsToCells(result.items, geometry, BOARD_ACCEPT_CONFIDENCE);
}

async function recognizeCells(
  square: HTMLCanvasElement,
  geometry: GridGeometry,
  ocr: PaddleOcrEngine,
  grid: SudokuGrid,
  confidence: number[][],
  onProgress?: ProgressCallback
) {
  for (let row = 0; row < CELL_COUNT; row += 1) {
    for (let col = 0; col < CELL_COUNT; col += 1) {
      if (grid[row][col]) continue;

      const cellCanvas = cropCell(square, geometry, row, col);
      if (getInkRatio(cellCanvas) < MIN_INK_RATIO) {
        reportCellProgress(onProgress, row, col);
        continue;
      }

      const variants = [preprocessCanvas(cellCanvas, 120), preprocessCanvas(cellCanvas, 145), preprocessCanvas(cellCanvas, 175)];
      const candidates: DigitCandidate[] = [];

      for (const variant of variants) {
        const [result] = await ocr.predict(variant, {
          textDetLimitType: "max",
          textDetLimitSideLen: 192,
          textDetBoxThresh: 0.04,
          textRecScoreThresh: 0.03
        });
        candidates.push(bestDigitFromItems(result.items));
      }

      const best = voteCandidates(candidates);
      if (best.digit && (best.confidence >= OCR_ACCEPT_CONFIDENCE || ((best.votes ?? 0) >= 2 && best.confidence >= 32))) {
        grid[row][col] = best.digit;
        confidence[row][col] = Math.round(best.confidence);
      }

      reportCellProgress(onProgress, row, col);
    }
  }
}

function mapOcrItemsToCells(items: OcrResultItem[], geometry: GridGeometry, minConfidence: number): CellCandidate[] {
  const candidates: CellCandidate[] = [];

  for (const item of items) {
    const digit = parseRecognizedDigit(item.text);
    const confidence = scoreToConfidence(item.score);
    if (!digit || confidence < minConfidence) continue;

    const { x, y } = centerOfPoly(item.poly);
    const col = Math.floor((x - geometry.x0) / geometry.cellWidth);
    const row = Math.floor((y - geometry.y0) / geometry.cellHeight);

    if (row < 0 || row >= CELL_COUNT || col < 0 || col >= CELL_COUNT) continue;
    candidates.push({ row, col, digit, confidence });
  }

  return candidates;
}

function bestDigitFromItems(items: OcrResultItem[]): DigitCandidate {
  let best: DigitCandidate = { digit: null, confidence: 0 };

  for (const item of items) {
    const digit = parseRecognizedDigit(item.text);
    const confidence = scoreToConfidence(item.score);
    if (digit && confidence > best.confidence) {
      best = { digit, confidence };
    }
  }

  return best;
}

function scoreToConfidence(score: number): number {
  const normalized = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, normalized));
}

function centerOfPoly(poly: Array<[number, number]>): { x: number; y: number } {
  if (poly.length === 0) return { x: 0, y: 0 };
  const total = poly.reduce(
    (sum, point) => ({
      x: sum.x + point[0],
      y: sum.y + point[1]
    }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / poly.length,
    y: total.y / poly.length
  };
}

function applyCandidates(grid: SudokuGrid, confidence: number[][], candidates: CellCandidate[]) {
  for (const candidate of candidates) {
    if (candidate.confidence <= confidence[candidate.row][candidate.col]) continue;
    grid[candidate.row][candidate.col] = candidate.digit;
    confidence[candidate.row][candidate.col] = Math.round(candidate.confidence);
  }
}

function removeDuplicateConflicts(grid: SudokuGrid, confidence: number[][]) {
  for (let row = 0; row < CELL_COUNT; row += 1) {
    clearUnitDuplicates(Array.from({ length: CELL_COUNT }, (_, col) => ({ row, col })), grid, confidence);
  }

  for (let col = 0; col < CELL_COUNT; col += 1) {
    clearUnitDuplicates(Array.from({ length: CELL_COUNT }, (_, row) => ({ row, col })), grid, confidence);
  }

  for (let boxRow = 0; boxRow < CELL_COUNT; boxRow += 3) {
    for (let boxCol = 0; boxCol < CELL_COUNT; boxCol += 3) {
      const cells = [];
      for (let row = boxRow; row < boxRow + 3; row += 1) {
        for (let col = boxCol; col < boxCol + 3; col += 1) {
          cells.push({ row, col });
        }
      }
      clearUnitDuplicates(cells, grid, confidence);
    }
  }
}

function clearUnitDuplicates(cells: Array<{ row: number; col: number }>, grid: SudokuGrid, confidence: number[][]) {
  const byDigit = new Map<number, Array<{ row: number; col: number; confidence: number }>>();

  for (const cell of cells) {
    const digit = grid[cell.row][cell.col];
    if (!digit) continue;
    byDigit.set(digit, [...(byDigit.get(digit) ?? []), { ...cell, confidence: confidence[cell.row][cell.col] }]);
  }

  for (const matches of byDigit.values()) {
    if (matches.length < 2) continue;
    const winner = matches.reduce((best, cell) => (cell.confidence > best.confidence ? cell : best), matches[0]);
    for (const cell of matches) {
      if (cell.row === winner.row && cell.col === winner.col) continue;
      grid[cell.row][cell.col] = null;
      confidence[cell.row][cell.col] = 0;
    }
  }
}

function detectGridGeometry(square: HTMLCanvasElement): GridGeometry {
  const xBounds = detectAxisBounds(square, "x");
  const yBounds = detectAxisBounds(square, "y");
  const margin = square.width * 0.012;
  const x0 = clamp(xBounds.start - margin, 0, square.width - 1);
  const y0 = clamp(yBounds.start - margin, 0, square.height - 1);
  const x1 = clamp(xBounds.end + margin, x0 + 1, square.width);
  const y1 = clamp(yBounds.end + margin, y0 + 1, square.height);

  return {
    x0,
    y0,
    x1,
    y1,
    cellWidth: (x1 - x0) / CELL_COUNT,
    cellHeight: (y1 - y0) / CELL_COUNT
  };
}

function detectAxisBounds(canvas: HTMLCanvasElement, axis: "x" | "y"): { start: number; end: number } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { start: 0, end: axis === "x" ? canvas.width : canvas.height };

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const length = axis === "x" ? canvas.width : canvas.height;
  const crossLength = axis === "x" ? canvas.height : canvas.width;
  const scores = new Array<number>(length).fill(0);

  for (let primary = 0; primary < length; primary += 1) {
    for (let cross = 0; cross < crossLength; cross += 1) {
      const x = axis === "x" ? primary : cross;
      const y = axis === "x" ? cross : primary;
      const index = (y * canvas.width + x) * 4;
      const gray = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114;
      if (gray < 120) scores[primary] += 1;
    }
  }

  const groups = collectLineGroups(scores, crossLength * 0.28, length * 0.04);
  const strongGroups = groups
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .sort((a, b) => a.start - b.start);

  if (strongGroups.length >= 2) {
    return {
      start: centerOfGroup(strongGroups[0]),
      end: centerOfGroup(strongGroups[strongGroups.length - 1])
    };
  }

  return { start: 0, end: length };
}

function collectLineGroups(scores: number[], threshold: number, maxWidth: number) {
  const groups: Array<{ start: number; end: number; score: number }> = [];
  let current: { start: number; end: number; score: number } | null = null;

  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] >= threshold) {
      if (!current) current = { start: index, end: index, score: 0 };
      current.end = index;
      current.score += scores[index];
    } else if (current) {
      if (current.end - current.start <= maxWidth) groups.push(current);
      current = null;
    }
  }

  if (current && current.end - current.start <= maxWidth) groups.push(current);
  return groups;
}

function centerOfGroup(group: { start: number; end: number }) {
  return (group.start + group.end) / 2;
}

function eraseGridLines(source: HTMLCanvasElement, geometry: GridGeometry): HTMLCanvasElement {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.fillStyle = "#ffffff";

  for (let index = 0; index <= CELL_COUNT; index += 1) {
    const x = Math.round(geometry.x0 + geometry.cellWidth * index);
    const y = Math.round(geometry.y0 + geometry.cellHeight * index);
    const width = index % 3 === 0 ? 10 : 6;
    ctx.fillRect(x - width / 2, geometry.y0, width, geometry.y1 - geometry.y0);
    ctx.fillRect(geometry.x0, y - width / 2, geometry.x1 - geometry.x0, width);
  }

  return canvas;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });
}

function drawImageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCenterSquare(source: HTMLCanvasElement): HTMLCanvasElement {
  const side = Math.min(source.width, source.height);
  const x = Math.round((source.width - side) / 2);
  const y = Math.round((source.height - side) / 2);
  return cropSquare(source, x, y, side);
}

function cropSquare(source: HTMLCanvasElement, x: number, y: number, side: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 900;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.drawImage(source, x, y, side, side, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCell(source: HTMLCanvasElement, geometry: GridGeometry, row: number, col: number): HTMLCanvasElement {
  const x = geometry.x0 + col * geometry.cellWidth;
  const y = geometry.y0 + row * geometry.cellHeight;
  const insetX = geometry.cellWidth * 0.2;
  const insetY = geometry.cellHeight * 0.2;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    source,
    x + insetX,
    y + insetY,
    geometry.cellWidth - insetX * 2,
    geometry.cellHeight - insetY * 2,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

function preprocessCanvas(source: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const canvas = cloneCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const value = gray < threshold ? 0 : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function getInkRatio(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let darkPixels = 0;

  for (let index = 0; index < imageData.data.length; index += 4) {
    const gray = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114;
    if (gray < 150) darkPixels += 1;
  }

  return darkPixels / (canvas.width * canvas.height);
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function voteCandidates(candidates: DigitCandidate[]): DigitCandidate {
  const scores = new Map<number, number>();

  for (const candidate of candidates) {
    if (!candidate.digit) continue;
    scores.set(candidate.digit, (scores.get(candidate.digit) ?? 0) + candidate.confidence);
  }

  let bestDigit: number | null = null;
  let bestScore = 0;
  for (const [digit, score] of scores) {
    if (score > bestScore) {
      bestDigit = digit;
      bestScore = score;
    }
  }

  if (!bestDigit) return { digit: null, confidence: 0 };
  const agreeing = candidates.filter((candidate) => candidate.digit === bestDigit);
  const averageConfidence = agreeing.reduce((sum, candidate) => sum + candidate.confidence, 0) / agreeing.length;
  const agreementBonus = agreeing.length >= 2 ? 10 : 0;
  return { digit: bestDigit, confidence: Math.min(100, averageConfidence + agreementBonus), votes: agreeing.length };
}

function parseRecognizedDigit(text: string): number | null {
  const digits = text.match(/[1-9]/g) ?? [];
  if (digits.length !== 1) return null;
  return Number(digits[0]);
}

function reportCellProgress(onProgress: ProgressCallback | undefined, row: number, col: number) {
  const done = row * CELL_COUNT + col + 1;
  if (done % 9 === 0 || done === 81) {
    onProgress?.(`正在逐格补识别 ${done}/81`, 0.28 + (done / 81) * 0.67);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
