export type Position = [number, number, number];
/** `axis` is the array axis the slice is taken along; `col`/`row` are the array axes shown left-to-right and
 *  (after the server's vertical flip) bottom-to-top, matching backend/app/volume_mpr.py. */
export type Plane = { id: "axial" | "coronal" | "sagittal"; label: string; axis: 0 | 1 | 2; col: 0 | 1 | 2; row: 0 | 1 | 2 };

export const PLANES: Plane[] = [
  { id: "axial", label: "Axial", axis: 2, col: 0, row: 1 },
  { id: "coronal", label: "Coronal", axis: 1, col: 0, row: 2 },
  { id: "sagittal", label: "Sagittal", axis: 0, col: 1, row: 2 },
];

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export function clampPosition(position: Position, shape: number[]): Position {
  return position.map((value, axis) => Math.max(0, Math.min(Math.max(1, shape[axis] ?? 1) - 1, Math.round(value)))) as Position;
}

export function centerPosition(shape: number[]): Position {
  return clampPosition([0, 1, 2].map(axis => Math.floor((shape[axis] ?? 1) / 2)) as Position, shape);
}

/** Where the crosshair sits inside a slice image, as fractions of its width and height (top-left origin). */
export function crosshairFraction(plane: Plane, position: Position, shape: number[]) {
  const columns = Math.max(1, shape[plane.col] ?? 1), rows = Math.max(1, shape[plane.row] ?? 1);
  return { fx: (position[plane.col] + 0.5) / columns, fy: 1 - (position[plane.row] + 0.5) / rows };
}

/** A click at fractions (fx, fy) of the image sets the two in-plane coordinates and keeps the slice index. */
export function positionFromClick(plane: Plane, position: Position, shape: number[], fx: number, fy: number): Position {
  const next = [...position] as Position;
  next[plane.col] = Math.floor(Math.max(0, Math.min(0.999999, fx)) * Math.max(1, shape[plane.col] ?? 1));
  next[plane.row] = Math.floor((1 - Math.max(0, Math.min(1, fy))) * Math.max(1, shape[plane.row] ?? 1));
  return clampPosition(next, shape);
}

export function stepAlong(plane: Plane, position: Position, shape: number[], delta: number): Position {
  const next = [...position] as Position;
  next[plane.axis] += delta;
  return clampPosition(next, shape);
}

export function clampZoom(zoom: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}

/** Keeps a zoomed image covering its frame: pan is in frame pixels, zero when not zoomed. */
export function clampPan(pan: { x: number; y: number }, zoom: number, width: number, height: number) {
  const limitX = (width * (zoom - 1)) / 2, limitY = (height * (zoom - 1)) / 2;
  return { x: Math.max(-limitX, Math.min(limitX, pan.x)) || 0, y: Math.max(-limitY, Math.min(limitY, pan.y)) || 0 };
}
