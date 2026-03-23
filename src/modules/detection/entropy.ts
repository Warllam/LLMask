/**
 * Calculate Shannon entropy of a string.
 * Higher entropy → more random → more likely to be a secret.
 * Typical thresholds: > 4.5 for hex secrets, > 5.0 for base64 secrets.
 */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}
