import { Camera, CheckCircle2, Eraser, FileImage, Loader2, RotateCcw, Sparkles, Upload } from "lucide-react";
import { ChangeEvent, DragEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { recognizeSudokuFromImage } from "./ocr";
import { cloneGrid, createEmptyGrid, normalizeCell, solveSudoku, validateGrid } from "./sudoku";
import type { RecognitionResult, SolveResult, SudokuGrid } from "./types";

type SelectedCell = { row: number; col: number } | null;

const emptyConfidence = () => createEmptyGrid().map((row) => row.map(() => 0));

export function App() {
  const [grid, setGrid] = useState<SudokuGrid>(() => createEmptyGrid());
  const [initialGrid, setInitialGrid] = useState<SudokuGrid>(() => createEmptyGrid());
  const [confidence, setConfidence] = useState<number[][]>(() => emptyConfidence());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressValue, setProgressValue] = useState(0);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validationMessage = useMemo(() => validateGrid(grid), [grid]);
  const conflictCells = useMemo(() => getConflictCells(grid), [grid]);
  const filledCount = useMemo(() => grid.flat().filter(Boolean).length, [grid]);

  async function handleFile(file: File) {
    let lastProgressUpdate = 0;
    setIsRecognizing(true);
    setSolveResult(null);
    setWarnings([]);
    setSelectedCell(null);
    setProgressText("正在准备图片");
    setProgressValue(0.02);

    try {
      const result = await recognizeSudokuFromImage(file, (message, progress) => {
        const now = Date.now();
        const isFinalProgress = typeof progress === "number" && progress >= 0.98;
        if (!isFinalProgress && now - lastProgressUpdate < 180) return;
        lastProgressUpdate = now;
        setProgressText(message);
        if (typeof progress === "number") setProgressValue(progress);
      });
      applyRecognition(result);
      setProgressText("识别完成");
      setProgressValue(1);
    } catch (error) {
      const fallbackUrl = URL.createObjectURL(file);
      setImageUrl(fallbackUrl);
      setGrid(createEmptyGrid());
      setInitialGrid(createEmptyGrid());
      setConfidence(emptyConfidence());
      setWarnings([error instanceof Error ? error.message : "识别失败，请手动录入题目。"]);
    } finally {
      setIsRecognizing(false);
    }
  }

  function applyRecognition(result: RecognitionResult) {
    setGrid(result.grid);
    setInitialGrid(cloneGrid(result.grid));
    setConfidence(result.confidence);
    setImageUrl(result.sourceImageUrl);
    setWarnings(result.warnings);
  }

  function updateCell(row: number, col: number, value: string) {
    setGrid((current) => {
      const next = cloneGrid(current);
      next[row][col] = normalizeCell(value);
      return next;
    });
    setSolveResult(null);
  }

  function setSelectedValue(value: number | null) {
    if (!selectedCell) return;
    updateCell(selectedCell.row, selectedCell.col, value?.toString() ?? "");
  }

  function clearGrid() {
    const empty = createEmptyGrid();
    setGrid(empty);
    setInitialGrid(empty);
    setConfidence(emptyConfidence());
    setSolveResult(null);
    setWarnings([]);
    setSelectedCell(null);
  }

  function solveCurrentGrid() {
    setSolveResult(solveSudoku(grid));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) void handleFile(file);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Sudoku Lens</p>
          <h1>拍照、校正、求解数独</h1>
        </div>
        <button className="ghost-button" onClick={clearGrid} type="button">
          <RotateCcw size={18} />
          重置
        </button>
      </section>

      <section className="workspace">
        <div className="capture-panel">
          <div
            className={`drop-zone ${dragActive ? "drag-active" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="上传的数独" />
            ) : (
              <div className="empty-upload">
                <FileImage size={44} />
                <p>选择或拖入一张数独照片</p>
              </div>
            )}
            {isRecognizing && (
              <div className="recognizing-overlay">
                <Loader2 className="spin" size={28} />
                <span>{progressText || "正在识别"}</span>
                <div className="progress-track">
                  <div style={{ width: `${Math.round(progressValue * 100)}%` }} />
                </div>
              </div>
            )}
          </div>

          <input ref={fileInputRef} accept="image/*" capture="environment" className="file-input" onChange={onFileChange} type="file" />

          <div className="button-row">
            <button className="primary-button" onClick={() => fileInputRef.current?.click()} type="button">
              <Camera size={18} />
              拍照 / 上传
            </button>
            <button className="secondary-button" disabled={!imageUrl || isRecognizing} onClick={() => fileInputRef.current?.click()} type="button">
              <Upload size={18} />
              重新识别
            </button>
          </div>

          <div className="status-list">
            <div>
              <CheckCircle2 size={16} />
              已填入 {filledCount} 个数字
            </div>
            {warnings.map((warning) => (
              <div key={warning}>
                <Sparkles size={16} />
                {warning}
              </div>
            ))}
          </div>
        </div>

        <div className="board-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">校正棋盘</p>
              <h2>核对识别结果</h2>
            </div>
            <button className="ghost-button" onClick={clearGrid} type="button">
              <Eraser size={18} />
              清空
            </button>
          </div>

          <SudokuBoard
            confidence={confidence}
            conflictCells={conflictCells}
            grid={grid}
            initialGrid={initialGrid}
            onCellChange={updateCell}
            onSelectCell={setSelectedCell}
            selectedCell={selectedCell}
          />

          <NumberPad disabled={!selectedCell} onPick={setSelectedValue} selectedCell={selectedCell} />

          <div className="solve-actions">
            <button className="primary-button" disabled={Boolean(validationMessage) || filledCount === 0} onClick={solveCurrentGrid} type="button">
              <Sparkles size={18} />
              一键求解
            </button>
            {validationMessage && <p className="error-text">{validationMessage}</p>}
          </div>

          {solveResult && <ResultPanel initialGrid={grid} result={solveResult} />}
        </div>
      </section>
    </main>
  );
}

function SudokuBoard({
  grid,
  initialGrid,
  confidence,
  conflictCells,
  selectedCell,
  onCellChange,
  onSelectCell
}: {
  grid: SudokuGrid;
  initialGrid: SudokuGrid;
  confidence: number[][];
  conflictCells: Set<string>;
  selectedCell: SelectedCell;
  onCellChange: (row: number, col: number, value: string) => void;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "Tab") return;
    if (/^[1-9]$/.test(event.key)) return;
    event.preventDefault();
  }

  return (
    <div className="sudoku-board" aria-label="数独校正棋盘">
      {grid.map((rowValues, row) =>
        rowValues.map((value, col) => {
          const isRecognized = Boolean(initialGrid[row][col]);
          const lowConfidence = isRecognized && confidence[row][col] < 68;
          const hasConflict = conflictCells.has(cellKey(row, col));
          const isSelected = selectedCell?.row === row && selectedCell.col === col;
          return (
            <input
              aria-label={`第 ${row + 1} 行第 ${col + 1} 列`}
              className={`${isRecognized ? "recognized" : ""} ${lowConfidence ? "low-confidence" : ""} ${hasConflict ? "conflict-cell" : ""} ${isSelected ? "selected-cell" : ""}`}
              inputMode="numeric"
              key={`${row}-${col}`}
              maxLength={1}
              onChange={(event) => onCellChange(row, col, event.target.value)}
              onFocus={(event) => {
                onSelectCell({ row, col });
                event.currentTarget.select();
              }}
              onKeyDown={handleKey}
              pattern="[1-9]"
              title={isRecognized ? `识别置信度 ${confidence[row][col]}%` : "空格"}
              value={value ?? ""}
            />
          );
        })
      )}
    </div>
  );
}

function NumberPad({ disabled, selectedCell, onPick }: { disabled: boolean; selectedCell: SelectedCell; onPick: (value: number | null) => void }) {
  return (
    <div className="number-pad" aria-label="数字输入面板">
      <span>{selectedCell ? `第 ${selectedCell.row + 1} 行第 ${selectedCell.col + 1} 列` : "点选一个格子后快速改数字"}</span>
      <div>
        {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
          <button disabled={disabled} key={value} onClick={() => onPick(value)} type="button">
            {value}
          </button>
        ))}
        <button className="clear-cell-button" disabled={disabled} onClick={() => onPick(null)} type="button">
          清除
        </button>
      </div>
    </div>
  );
}

function ResultPanel({ result, initialGrid }: { result: SolveResult; initialGrid: SudokuGrid }) {
  if (result.status === "invalid") {
    return <div className="result-card error">题目有冲突：{result.reason}</div>;
  }

  if (result.status === "unsolvable") {
    return <div className="result-card error">这个题目暂时无解，请检查是否有识别错误。</div>;
  }

  const note = result.status === "multiple" ? "这个题目存在多个解，下面显示其中一个。" : "求解完成。";

  return (
    <div className="result-card">
      <div className="result-heading">
        <CheckCircle2 size={18} />
        <span>{note}</span>
      </div>
      <div className="solution-board" aria-label="数独答案">
        {result.solution.map((rowValues, row) =>
          rowValues.map((value, col) => (
            <span className={initialGrid[row][col] ? "given" : "solved"} key={`${row}-${col}`}>
              {value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function getConflictCells(grid: SudokuGrid): Set<string> {
  const conflicts = new Set<string>();

  for (let row = 0; row < 9; row += 1) {
    markDuplicates(
      Array.from({ length: 9 }, (_, col) => ({ row, col, value: grid[row][col] })),
      conflicts
    );
  }

  for (let col = 0; col < 9; col += 1) {
    markDuplicates(
      Array.from({ length: 9 }, (_, row) => ({ row, col, value: grid[row][col] })),
      conflicts
    );
  }

  for (let boxRow = 0; boxRow < 9; boxRow += 3) {
    for (let boxCol = 0; boxCol < 9; boxCol += 3) {
      const cells = [];
      for (let row = boxRow; row < boxRow + 3; row += 1) {
        for (let col = boxCol; col < boxCol + 3; col += 1) {
          cells.push({ row, col, value: grid[row][col] });
        }
      }
      markDuplicates(cells, conflicts);
    }
  }

  return conflicts;
}

function markDuplicates(cells: Array<{ row: number; col: number; value: number | null }>, conflicts: Set<string>) {
  const byValue = new Map<number, Array<{ row: number; col: number }>>();

  for (const cell of cells) {
    if (!cell.value) continue;
    byValue.set(cell.value, [...(byValue.get(cell.value) ?? []), cell]);
  }

  for (const duplicates of byValue.values()) {
    if (duplicates.length < 2) continue;
    for (const cell of duplicates) {
      conflicts.add(cellKey(cell.row, cell.col));
    }
  }
}

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}
