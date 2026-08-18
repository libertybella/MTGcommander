export type ClassOracleSection = {
  level: number;
  text: string;
};

export function classOracleSections(oracleText: string): ClassOracleSection[] {
  const chunks = oracleText
    .split(/(?<!\})(?=(?:\{[^}]+\})+: Level \d+)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length <= 1) {
    return [{ level: 1, text: oracleText }];
  }
  return chunks.map((chunk, index) => {
    const match = chunk.match(/^(?:\{[^}]+\})+: Level (\d+)/i);
    return {
      level: match?.[1] ? Number(match[1]) : index + 1,
      text: chunk,
    };
  });
}
