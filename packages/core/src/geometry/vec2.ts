/**
 * 2D vector / point primitives. Plain data; operations are pure functions.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const V = (x: number, y: number): Vec2 => ({ x, y });

export const vAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vSub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vScale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vDot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const vCross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const vLen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vLenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const vDist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vDistSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const vNorm = (a: Vec2): Vec2 => {
  const l = vLen(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const vEq = (a: Vec2, b: Vec2, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Rotate point p around origin by `angle` radians (CCW). */
export const vRot = (p: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** Lerp */
export const vLerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
