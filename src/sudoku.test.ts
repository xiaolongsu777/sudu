import { describe, expect, it } from "vitest";
import { createEmptyGrid, normalizeCell, solveSudoku, validateGrid } from "./sudoku";
import type { SudokuGrid } from "./types";

const puzzle: SudokuGrid = [
  [5, 3, null, null, 7, null, null, null, null],
  [6, null, null, 1, 9, 5, null, null, null],
  [null, 9, 8, null, null, null, null, 6, null],
  [8, null, null, null, 6, null, null, null, 3],
  [4, null, null, 8, null, 3, null, null, 1],
  [7, null, null, null, 2, null, null, null, 6],
  [null, 6, null, null, null, null, 2, 8, null],
  [null, null, null, 4, 1, 9, null, null, 5],
  [null, null, null, null, 8, null, null, 7, 9]
];

describe("sudoku solver", () => {
  it("solves a standard puzzle", () => {
    const result = solveSudoku(puzzle);
    expect(result.status).toBe("solved");
    if (result.status === "solved") {
      expect(result.solution[0]).toEqual([5, 3, 4, 6, 7, 8, 9, 1, 2]);
      expect(result.solution[8]).toEqual([3, 4, 5, 2, 8, 6, 1, 7, 9]);
    }
  });

  it("rejects conflicting givens", () => {
    const invalid = createEmptyGrid();
    invalid[0][0] = 4;
    invalid[0][4] = 4;
    expect(validateGrid(invalid)).toContain("重复数字 4");
    expect(solveSudoku(invalid).status).toBe("invalid");
  });

  it("reports unsolvable puzzles", () => {
    const unsolvable = createEmptyGrid();
    unsolvable[0] = [1, 2, 3, 4, 5, 6, 7, 8, null];
    unsolvable[1][8] = 9;
    const result = solveSudoku(unsolvable);
    expect(result.status).toBe("unsolvable");
  });

  it("normalizes invalid and empty values", () => {
    expect(normalizeCell("")).toBeNull();
    expect(normalizeCell("8")).toBe(8);
    expect(normalizeCell(10)).toBeNull();
    expect(normalizeCell("x")).toBeNull();
  });

  it("detects multiple solutions for an empty board", () => {
    const result = solveSudoku(createEmptyGrid());
    expect(result.status).toBe("multiple");
  });
});
