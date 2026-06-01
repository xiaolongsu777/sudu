import type { SolveResult, SudokuCell, SudokuGrid } from "./types";

export const GRID_SIZE = 9;
export const BOX_SIZE = 3;

export function createEmptyGrid(): SudokuGrid {
  return Array.from({ length: GRID_SIZE }, () => Array<SudokuCell>(GRID_SIZE).fill(null));
}

export function cloneGrid(grid: SudokuGrid): SudokuGrid {
  return grid.map((row) => row.slice());
}

export function normalizeCell(value: unknown): SudokuCell {
  if (value === null || value === undefined || value === "" || value === 0) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= 9 ? numberValue : null;
}

export function normalizeGrid(grid: SudokuGrid): SudokuGrid {
  return Array.from({ length: GRID_SIZE }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => normalizeCell(grid[row]?.[col]))
  );
}

export function validateGrid(grid: SudokuGrid): string | null {
  const normalized = normalizeGrid(grid);

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const seen = new Set<number>();
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const value = normalized[row][col];
      if (!value) continue;
      if (seen.has(value)) return `第 ${row + 1} 行有重复数字 ${value}`;
      seen.add(value);
    }
  }

  for (let col = 0; col < GRID_SIZE; col += 1) {
    const seen = new Set<number>();
    for (let row = 0; row < GRID_SIZE; row += 1) {
      const value = normalized[row][col];
      if (!value) continue;
      if (seen.has(value)) return `第 ${col + 1} 列有重复数字 ${value}`;
      seen.add(value);
    }
  }

  for (let boxRow = 0; boxRow < GRID_SIZE; boxRow += BOX_SIZE) {
    for (let boxCol = 0; boxCol < GRID_SIZE; boxCol += BOX_SIZE) {
      const seen = new Set<number>();
      for (let row = boxRow; row < boxRow + BOX_SIZE; row += 1) {
        for (let col = boxCol; col < boxCol + BOX_SIZE; col += 1) {
          const value = normalized[row][col];
          if (!value) continue;
          if (seen.has(value)) {
            return `第 ${Math.floor(boxRow / BOX_SIZE) + 1} 行第 ${Math.floor(boxCol / BOX_SIZE) + 1} 个九宫格有重复数字 ${value}`;
          }
          seen.add(value);
        }
      }
    }
  }

  return null;
}

export function solveSudoku(grid: SudokuGrid): SolveResult {
  const invalidReason = validateGrid(grid);
  if (invalidReason) {
    return { status: "invalid", reason: invalidReason };
  }

  const board = normalizeGrid(grid);
  const solutions: SudokuGrid[] = [];

  search(board, solutions, 2);

  if (solutions.length === 0) return { status: "unsolvable" };
  if (solutions.length > 1) return { status: "multiple", solution: solutions[0] };
  return { status: "solved", solution: solutions[0] };
}

function search(board: SudokuGrid, solutions: SudokuGrid[], limit: number): void {
  if (solutions.length >= limit) return;

  const next = findBestEmptyCell(board);
  if (!next) {
    solutions.push(cloneGrid(board));
    return;
  }

  for (const candidate of next.candidates) {
    board[next.row][next.col] = candidate;
    search(board, solutions, limit);
    board[next.row][next.col] = null;
    if (solutions.length >= limit) return;
  }
}

function findBestEmptyCell(board: SudokuGrid): { row: number; col: number; candidates: number[] } | null {
  let best: { row: number; col: number; candidates: number[] } | null = null;

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if (board[row][col]) continue;
      const candidates = getCandidates(board, row, col);
      if (candidates.length === 0) return { row, col, candidates };
      if (!best || candidates.length < best.candidates.length) {
        best = { row, col, candidates };
      }
    }
  }

  return best;
}

function getCandidates(board: SudokuGrid, row: number, col: number): number[] {
  const used = new Set<number>();

  for (let index = 0; index < GRID_SIZE; index += 1) {
    const rowValue = board[row][index];
    const colValue = board[index][col];
    if (rowValue) used.add(rowValue);
    if (colValue) used.add(colValue);
  }

  const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
  const boxCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;
  for (let r = boxRow; r < boxRow + BOX_SIZE; r += 1) {
    for (let c = boxCol; c < boxCol + BOX_SIZE; c += 1) {
      const value = board[r][c];
      if (value) used.add(value);
    }
  }

  return Array.from({ length: GRID_SIZE }, (_, index) => index + 1).filter((value) => !used.has(value));
}
