export type MatchableSignal = {
  type: "need" | "can";
  category: string;
  title: string;
  description: string;
};

function tokens(value: string) {
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

/**
 * Scores a NEED/CAN pair using category equality first, then meaningful-word
 * overlap in titles and descriptions. Returned scores are deterministic and
 * do not imply an automatic match or connection.
 */
export function scoreSignalPair(first: MatchableSignal, second: MatchableSignal) {
  if (first.type === second.type) return 0;
  if (first.category.trim().toLocaleLowerCase() === second.category.trim().toLocaleLowerCase()) return 88;

  const firstTokens = tokens(`${first.title} ${first.description}`);
  const secondTokens = tokens(`${second.title} ${second.description}`);
  const overlap = Array.from(firstTokens).filter((token) => secondTokens.has(token)).length;
  const denominator = Math.max(1, Math.min(firstTokens.size, secondTokens.size));
  if (overlap === 0) return 0;

  return Math.min(79, Math.round(48 + (overlap / denominator) * 31));
}
