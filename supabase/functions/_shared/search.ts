export type ProofSearchRow = Record<string, unknown> & {
  id?: unknown;
  similarity?: unknown;
  relevance?: unknown;
};

export function fuseRows(
  semanticRows: ProofSearchRow[],
  lexicalRows: ProofSearchRow[],
  limit: number,
): Array<{ row: ProofSearchRow; relevance: number }> {
  const rows = new Map<string, { row: ProofSearchRow; relevance: number }>();
  const add = (arm: ProofSearchRow[]) => {
    arm.forEach((row, index) => {
      if (typeof row.id !== "string") return;
      const relevance = 1 / (60 + index + 1);
      const existing = rows.get(row.id);
      if (existing) existing.relevance += relevance;
      else rows.set(row.id, { row, relevance });
    });
  };

  add(semanticRows);
  add(lexicalRows);
  return [...rows.values()]
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, limit);
}
