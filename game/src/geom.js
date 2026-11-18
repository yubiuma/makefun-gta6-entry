// Small geometry helpers shared by the city, the simulation and the renderer: clamping,
// angles, distances, and the circle-versus-rectangle test every collision in the game uses.

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Squared distance between two points; cheaper than the real thing and enough to compare. */
export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** The smallest signed turn from angle a to angle b, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn from a toward b by at most maxStep radians. */
export function angleTurn(a, b, maxStep) {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Push a circle out of a rectangle. Returns null when they do not touch, else the corrected
 * centre {x, y} and the outward normal (nx, ny) of the face that was hit, so callers can
 * cancel the velocity that points into the wall.
 */
export function circleRectResolve(cx, cy, radius, rect) {
  const nearX = clamp(cx, rect.x, rect.x + rect.w);
  const nearY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nearX;
  const dy = cy - nearY;
  const d2 = dx * dx + dy * dy;
  if (d2 > radius * radius) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { x: nearX + (dx / d) * radius, y: nearY + (dy / d) * radius, nx: dx / d, ny: dy / d };
  }
  // The centre is inside the rectangle: leave by the nearest face.
  const left = cx - rect.x;
  const right = rect.x + rect.w - cx;
  const top = cy - rect.y;
  const bottom = rect.y + rect.h - cy;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { x: rect.x - radius, y: cy, nx: -1, ny: 0 };
  if (min === right) return { x: rect.x + rect.w + radius, y: cy, nx: 1, ny: 0 };
  if (min === top) return { x: cx, y: rect.y - radius, nx: 0, ny: -1 };
  return { x: cx, y: rect.y + rect.h + radius, nx: 0, ny: 1 };
}

/** A stable small hash of two integers, for deterministic decoration like lit windows. */
export function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
