export type SudokuCell = number | null;
export type SudokuGrid = SudokuCell[][];

export type RecognitionResult = {
  grid: SudokuGrid;
  confidence: number[][];
  sourceImageUrl: string;
  warnings: string[];
};

export type SolveResult =
  | { status: "solved"; solution: SudokuGrid }
  | { status: "invalid"; reason: string }
  | { status: "unsolvable" }
  | { status: "multiple"; solution: SudokuGrid };
