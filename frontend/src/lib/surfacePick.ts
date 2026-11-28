export type Point3 = [number, number, number];

/** Pick the frontmost triangle in the orthographic canvas and interpolate its world position. */
export function pickSurface(
  vertices: Point3[], faces: [number, number, number][], world: Point3[], x: number, y: number,
): Point3 | null {
  let depth = -Infinity;
  let result: Point3 | null = null;
  for (const [i, j, k] of faces) {
    const [a, b, c] = [vertices[i], vertices[j], vertices[k]];
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(determinant) < 1e-9) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / determinant;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / determinant;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < 0) continue;
    const z = u * a[2] + v * b[2] + w * c[2];
    if (z <= depth) continue;
    depth = z;
    result = world[i].map((coordinate, axis) => u * coordinate + v * world[j][axis] + w * world[k][axis]) as Point3;
  }
  return result;
}
