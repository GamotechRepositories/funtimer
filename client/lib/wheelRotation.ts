export type ContinuousSpinState = {
  startMs: number;
  startRotation: number;
  degPerMs: number;
};

export type FinalSettleState = {
  startMs: number;
  fromRotation: number;
  distance: number;
  durationMs: number;
  startVelocity: number;
  acceleration: number;
};

export function rotationAtContinuousSpin(
  state: ContinuousSpinState,
  now = Date.now()
) {
  return state.startRotation + state.degPerMs * Math.max(0, now - state.startMs);
}

export function rotationAtFinalSettle(state: FinalSettleState, now = Date.now()) {
  const elapsed = Math.min(state.durationMs, Math.max(0, now - state.startMs));
  const traveled =
    state.startVelocity * elapsed +
    0.5 * state.acceleration * elapsed * elapsed;
  return state.fromRotation + Math.min(state.distance, Math.max(0, traveled));
}

export function isFinalSettleComplete(state: FinalSettleState, now = Date.now()) {
  return now - state.startMs >= state.durationMs;
}

export function computeNeededDelta(currentRotation: number, result: number) {
  const currentMod = ((currentRotation % 360) + 360) % 360;
  let neededDelta = -(result * 36) - currentMod;
  while (neededDelta <= 0) {
    neededDelta += 360;
  }
  return neededDelta;
}

export function snapRotationToResult(currentRotation: number, result: number) {
  return currentRotation + computeNeededDelta(currentRotation, result);
}

export function rotationModMatchesResult(rotation: number, result: number) {
  const rotMod = ((rotation % 360) + 360) % 360;
  const targetMod = (((-result * 36) % 360) + 360) % 360;
  const diff = Math.abs(rotMod - targetMod);
  return diff <= 1 || diff >= 359;
}
