export const PLUSH_SLIDE_DURATION = 1750;

/** Integrate gaze and its fur trail together, independent of GPU frame latency. */
export function plushGazeStep(position: number, lag: number, target: number, seconds: number) {
  const elapsed = Math.max(0, seconds);
  const decay = Math.exp(-14 * elapsed);
  const distance = target - position;
  return {
    position: target - distance * decay,
    lag: (lag + 14 * distance * elapsed) * decay,
  };
}

/** Shared trajectory for compositor translation and the fur's inertial response. */
export function plushSlidePosition(milliseconds: number, width: number) {
  const amplitude = Math.min(140, width * 0.24);
  const damping = 6.8;
  const elapsed = Math.max(0, milliseconds);
  if (elapsed >= PLUSH_SLIDE_DURATION) return 0;
  if (elapsed < 350) {
    const t = elapsed / 350;
    // Hermite entry matches the spring's starting position and velocity.
    return (2 * t ** 3 - 3 * t ** 2 + 1) * width
      + (-2 * t ** 3 + 3 * t ** 2) * amplitude
      + (t ** 3 - t ** 2) * (-8.75 * amplitude * 0.35);
  }
  const time = (elapsed - 350) / 1000;
  const frequency = Math.sqrt(14 ** 2 - damping ** 2);
  return Math.exp(-damping * time) * amplitude *
    (Math.cos(frequency * time) + (-8.75 + damping) / frequency * Math.sin(frequency * time));
}

/** Five slots on a tilted ring; its frontmost slot is the resting pose. */
export function plushOrbitPose(progress: number, width: number, height: number) {
  const stepAngle = Math.PI * 2 / 5;
  const angle = progress * stepAngle;
  const depth = 1 - Math.cos(angle);
  return {
    x: width * Math.sin(angle) / Math.sin(stepAngle),
    y: -Math.min(220, height * 0.28) * depth / (1 - Math.cos(stepAngle)),
    scale: 1 - depth * 0.32,
  };
}

/** Use adjacent slots across the first/last boundary, taking the shorter route. */
export function plushOrbitDirection(from: number, to: number, count: number) {
  const forward = (to - from + count) % count;
  return forward > count / 2 ? -1 : 1;
}

export function plushFurInertia(milliseconds: number, width: number, direction: number) {
  if (milliseconds <= 0 || milliseconds >= PLUSH_SLIDE_DURATION || width <= 0) return 0;
  const projectedX = (time: number) => plushOrbitPose(plushSlidePosition(time, width) / width, width, 0).x;
  const velocity = (projectedX(milliseconds + 4) - projectedX(milliseconds - 4)) / 0.008;
  return Math.max(-0.7, Math.min(0.7, -velocity / width * 0.36 * direction));
}
