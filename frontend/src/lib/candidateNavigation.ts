/** Presentation-only mapping of saved path geometry; never alters measurements. */
export function pathLabel(id: string) { return `Path ${id.replace(/^P/, '')}`; }
export function candidateLabel(id: string) { return `Candidate ${id.replace(/^C/, '')}`; }
export function pointOnPath(points: number[][], position: number) {
  if (!points.length) return null;
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(...points[i].map((v, a) => v - points[i - 1][a]));
    if (distance + length >= position && length > 0) {
      const t = Math.max(0, Math.min(1, (position - distance) / length));
      return points[i].map((v, a) => points[i - 1][a] + t * (v - points[i - 1][a]));
    }
    distance += length;
  }
  return points[points.length - 1];
}
export function positionOnPath(points: number[][], target: number[]) {
  let arc = 0, bestDistance = Infinity, result = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].map((v, a) => v - points[i - 1][a]);
    const square = delta.reduce((sum, v) => sum + v * v, 0);
    const t = square ? Math.max(0, Math.min(1, delta.reduce((sum, v, a) => sum + v * (target[a] - points[i - 1][a]), 0) / square)) : 0;
    const distance = Math.hypot(...delta.map((v, a) => points[i - 1][a] + t * v - target[a]));
    if (distance < bestDistance) { bestDistance = distance; result = arc + Math.sqrt(square) * t; }
    arc += Math.sqrt(square);
  }
  return result;
}
