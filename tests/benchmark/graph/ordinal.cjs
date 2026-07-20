/** Locale-independent text comparators for deterministic benchmark artifacts. */
function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Compare ASCII digit runs numerically, with ordinal text as every tie-break. */
function compareNaturalOrdinal(left, right) {
  const leftParts = left.split(/(\d+)/);
  const rightParts = right.split(/(\d+)/);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === b) continue;
    if (index % 2 === 1) {
      const difference = compareDecimalOrdinal(a, b);
      if (difference !== 0) return difference;
    }
    return compareOrdinal(a, b);
  }
  return leftParts.length - rightParts.length;
}

/** Compare arbitrary-length ASCII decimal integers without numeric rounding. */
function compareDecimalOrdinal(left, right) {
  const significant = (value) => {
    const first = value.search(/[^0]/);
    return first === -1 ? "0" : value.slice(first);
  };
  const a = significant(left);
  const b = significant(right);
  return a.length - b.length || compareOrdinal(a, b);
}

module.exports = { compareNaturalOrdinal, compareOrdinal };
