import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SquatRepTracker,
  angleAtVertex,
  getSquatMetrics,
  getTrackingStatus,
  isFullBodyVisible,
  makeRepMetric,
  smoothLandmarks,
} from '../src/lib/fitai-analysis.ts';
import {
  isZoomLevelConfirmed,
  labelSuggestsUltraWide,
  normalizeCameraFacing,
  supportsZoomLevel,
} from '../src/lib/camera-capabilities.ts';
import { createPoseWithCpuFallback } from '../src/lib/pose-runtime.ts';

function poseForAngle(angle, { confidence = 0.95, occlude = [] } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1, presence: 0.1 }));
  const hipY = 0.43 + ((180 - angle) / 180) * 0.18;
  const hip = { x: 0.45, y: hipY };
  const knee = { x: 0.48, y: 0.65 };
  const upperVectorAngle = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const lowerVectorAngle = upperVectorAngle + (angle * Math.PI) / 180;
  const ankle = {
    x: knee.x + Math.cos(lowerVectorAngle) * 0.18,
    y: knee.y + Math.sin(lowerVectorAngle) * 0.18,
  };
  const put = (index, x, y) => {
    points[index] = { x, y, visibility: confidence, presence: confidence };
  };
  put(0, 0.43, 0.07);
  put(7, 0.41, 0.075);
  put(8, 0.45, 0.075);
  put(11, 0.42, hipY - 0.2);
  put(23, hip.x, hip.y);
  put(25, knee.x, knee.y);
  put(27, ankle.x, ankle.y);
  put(29, ankle.x - 0.015, ankle.y + 0.035);
  put(31, ankle.x + 0.09, ankle.y + 0.035);
  for (const index of occlude) points[index].visibility = 0.1;
  return points;
}

function stand(tracker, timestamp = 0) {
  for (const [index, angle] of [175, 175, 175].entries()) {
    tracker.processPose([poseForAngle(angle)], timestamp + index * 50);
  }
}

function completeRep(tracker, offset = 0) {
  const angles = [175, 175, 175, 145, 135, 112, 106, 126, 140, 150, 160, 166, 170];
  let completed = null;
  angles.forEach((angle, index) => {
    const update = tracker.processPose([poseForAngle(angle)], offset + index * 50);
    completed = update.completedRep ?? completed;
  });
  return completed;
}

test('detects a same-side full body and usable squat landmarks', () => {
  const pose = poseForAngle(170);
  assert.equal(getTrackingStatus([pose]), 'tracking');
  assert.equal(isFullBodyVisible(pose), true);
  assert.ok(getSquatMetrics(pose));
});

test('rejects mixed-side points when neither side is complete', () => {
  const pose = poseForAngle(170);
  pose[27].visibility = 0.1;
  pose[28] = { ...pose[28], visibility: 0.95, presence: 0.95 };
  assert.equal(getTrackingStatus([pose]), 'incomplete');
});

test('marks occluded ankles as incomplete instead of estimating a rep', () => {
  const tracker = new SquatRepTracker();
  const pose = poseForAngle(170, { occlude: [27] });
  assert.equal(tracker.processPose([pose], 0).displayStatus, 'incomplete');
  assert.equal(tracker.getRepetitions().length, 0);
});

test('identifies multiple people and does not count their poses as one body', () => {
  const pose = poseForAngle(170);
  assert.equal(getTrackingStatus([pose, pose]), 'multiple');
  const tracker = new SquatRepTracker();
  assert.equal(tracker.processPose([pose, pose], 0).frame, null);
});

test('counts a complete squat only after a stable return to standing', () => {
  const tracker = new SquatRepTracker();
  const rep = completeRep(tracker);
  assert.ok(rep);
  assert.equal(tracker.getRepetitions().length, 1);
  assert.ok(rep.durationMs > 0);
  assert.ok(rep.trackingQuality.validFrames >= 8);
  assert.ok(rep.phaseAnalysis.every((phase) => phase.durationMs === null || phase.durationMs >= 0));
});

test('aborts a shallow partial descent that returns to standing', () => {
  const tracker = new SquatRepTracker();
  stand(tracker);
  for (const [index, angle] of [145, 135, 160, 165, 170].entries()) {
    tracker.processPose([poseForAngle(angle)], 200 + index * 50);
  }
  assert.equal(tracker.getRepetitions().length, 0);
});

test('clears an interrupted repetition but preserves completed repetitions', () => {
  const tracker = new SquatRepTracker();
  completeRep(tracker);
  tracker.processPose([], 800);
  assert.equal(tracker.getRepetitions().length, 1);
  assert.equal(tracker.processPose([poseForAngle(170)], 850).motionState, 'SETUP');
});

test('recovers tracking and counts a later repetition after a loss', () => {
  const tracker = new SquatRepTracker();
  tracker.processPose([poseForAngle(170)], 0);
  tracker.processPose([], 50);
  const rep = completeRep(tracker, 100);
  assert.ok(rep);
  assert.equal(tracker.getRepetitions().length, 1);
});

test('invalid or repeated timestamps reset the in-progress frame sequence', () => {
  const tracker = new SquatRepTracker();
  tracker.processPose([poseForAngle(170)], 100);
  const update = tracker.processPose([poseForAngle(170)], 100);
  assert.equal(update.displayStatus, 'incomplete');
  assert.equal(update.frame, null);
});

test('rejects degenerate joint angles and tolerates missing smoothed points', () => {
  assert.equal(angleAtVertex({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  const previous = poseForAngle(170);
  const next = poseForAngle(170);
  next[10] = undefined;
  assert.doesNotThrow(() => smoothLandmarks(previous, next));
});

test('does not invent a score or a duration when there are too few frames', () => {
  const rep = makeRepMetric(1, 90, Number.NaN, [], null);
  assert.equal(rep.executionIndex, null);
  assert.equal(rep.durationMs, null);
  assert.equal(rep.depthLabel, 'não avaliável');
});

test('reports missing confidence as low quality rather than assumed certainty', () => {
  const tracker = new SquatRepTracker();
  const angles = [175, 175, 175, 145, 135, 112, 106, 126, 140, 150, 160, 166, 170];
  let rep;
  angles.forEach((angle, index) => {
    const pointSet = poseForAngle(angle);
    pointSet.forEach((point) => {
      if (point.visibility === 0.95) {
        point.visibility = undefined;
        point.presence = undefined;
      }
    });
    rep = tracker.processPose([pointSet], index * 50).completedRep ?? rep;
  });
  assert.equal(rep?.trackingQuality.meanConfidence, 0);
  assert.equal(rep?.trackingQuality.level, 'baixa');
});

test('requires reported capability and confirmation for 0.5x zoom', () => {
  assert.equal(supportsZoomLevel({ min: 0.5, max: 3, step: 0.1 }, 0.5), true);
  assert.equal(supportsZoomLevel({ min: 1, max: 3 }, 0.5), false);
  assert.equal(isZoomLevelConfirmed(0.5, 0.5), true);
  assert.equal(isZoomLevelConfirmed(undefined, 0.5), false);
  assert.equal(labelSuggestsUltraWide('Back Ultra Wide'), true);
  assert.equal(labelSuggestsUltraWide('Back Camera'), false);
});

test('normalizes front and rear camera facing metadata without guessing', () => {
  assert.equal(normalizeCameraFacing('user'), 'frontal');
  assert.equal(normalizeCameraFacing('environment'), 'traseira');
  assert.equal(normalizeCameraFacing(undefined), 'não identificada');
});

test('retries GPU initialization on CPU while surfacing CPU startup errors', async () => {
  const calls = [];
  const fallback = await createPoseWithCpuFallback(async (delegate) => {
    calls.push(delegate);
    if (delegate === 'GPU') throw new Error('gpu unavailable');
    return 'cpu-model';
  });
  assert.deepEqual(calls, ['GPU', 'CPU']);
  assert.equal(fallback.delegate, 'CPU');
  assert.equal(fallback.poseLandmarker, 'cpu-model');
  await assert.rejects(() => createPoseWithCpuFallback(async (delegate) => {
    if (delegate === 'GPU') throw new Error('gpu unavailable');
    throw new Error('cpu unavailable');
  }), /cpu unavailable/);
});
