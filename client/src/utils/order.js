export function applyOrder(items, savedNames) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(savedNames) || savedNames.length === 0) return items;

  const byName = new Map(items.map(item => [item.name, item]));
  const ordered = [];
  const seen = new Set();

  for (const name of savedNames) {
    const item = byName.get(name);
    if (item && !seen.has(name)) {
      ordered.push(item);
      seen.add(name);
    }
  }

  for (const item of items) {
    if (!seen.has(item.name)) ordered.push(item);
  }

  return ordered;
}
