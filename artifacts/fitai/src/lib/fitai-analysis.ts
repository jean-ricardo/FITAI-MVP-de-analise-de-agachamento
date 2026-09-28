export type MotionState = 'EM_PÉ' | 'DESCENDO' | 'EMBAIXO' | 'SUBINDO';
export type Point = { x: number; y: number; z?: number; visibility?: number };

export type RepMetric = {
  id: number;
  minKneeAngle: number;
  depthPercent: number;
  executionIndex: number;
  durationMs: number;
  note: string;
};

export type FitaiReport = {
  id: string;
  completedAt: string;
  durationMs: number;
  repetitions: RepMetric[];
  executionIndex: number | null;
  reliability: 'reliable' | 'insufficient';
};

export type TrackingStatus = 'tracking' | 'bodyNotDetected' | 'multiple' | 'incomplete';

export const LANDMARK_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
];

const REQUIRED_LANDMARKS = [11, 12, 23, 24, 25, 26, 27, 28];

export function landmarkIsVisible(point?: Point, threshold = 0.58) {
  return Boolean(point && (point.visibility === undefined || point.visibility >= threshold));
}

export function getTrackingStatus(poses: Point[][]): TrackingStatus {
  if (!poses.length) return 'bodyNotDetected';
  if (poses.length > 1) return 'multiple';
  const visible = REQUIRED_LANDMARKS.filter((index) => landmarkIsVisible(poses[0][index])).length;
  return visible < 6 ? 'incomplete' : 'tracking';
}

export function smoothLandmarks(previous: Point[] | null, next: Point[], alpha = 0.38) {
  if (!previous || previous.length !== next.length) return next.map((point) => ({ ...point }));
  return next.map((point, index) => ({
    ...point,
    x: previous[index].x + (point.x - previous[index].x) * alpha,
    y: previous[index].y + (point.y - previous[index].y) * alpha,
    z: (previous[index].z ?? 0) + ((point.z ?? 0) - (previous[index].z ?? 0)) * alpha,
    visibility: point.visibility,
  }));
}

export function angleAtVertex(a: Point, b: Point, c: Point) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magnitude = Math.sqrt(ab.x ** 2 + ab.y ** 2) * Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (!magnitude) return 180;
  return Math.round((Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180) / Math.PI);
}

export function getSquatMetrics(pose: Point[]) {
  const leftReady = [pose[23], pose[25], pose[27]].every((point) => landmarkIsVisible(point));
  const rightReady = [pose[24], pose[26], pose[28]].every((point) => landmarkIsVisible(point));
  if (!leftReady && !rightReady) return null;
  const sides = [];
  if (leftReady) sides.push({ angle: angleAtVertex(pose[23], pose[25], pose[27]), hipY: pose[23].y });
  if (rightReady) sides.push({ angle: angleAtVertex(pose[24], pose[26], pose[28]), hipY: pose[24].y });
  return {
    kneeAngle: sides.reduce((sum, side) => sum + side.angle, 0) / sides.length,
    hipY: sides.reduce((sum, side) => sum + side.hipY, 0) / sides.length,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function makeRepMetric(id: number, minKneeAngle: number, durationMs: number): RepMetric {
  const depthPercent = Math.round(clamp(((170 - minKneeAngle) / 80) * 100, 0, 100));
  const depthContribution = clamp(depthPercent, 0, 100) * 0.52;
  const controlContribution = clamp(100 - Math.abs(780 - durationMs) / 10, 0, 100) * 0.48;
  const executionIndex = Math.round(clamp(depthContribution + controlContribution, 0, 100));
  const note = depthPercent >= 62 ? 'Profundidade consistente' : 'Busque um pouco mais de profundidade';
  return { id, minKneeAngle: Math.round(minKneeAngle), depthPercent, executionIndex, durationMs, note };
}

export function averageExecutionIndex(repetitions: RepMetric[]) {
  if (!repetitions.length) return null;
  return Math.round(repetitions.reduce((sum, rep) => sum + rep.executionIndex, 0) / repetitions.length);
}

const REPORT_KEY = 'fitai:last-report';

export function saveReport(report: FitaiReport) {
  localStorage.setItem(REPORT_KEY, JSON.stringify(report));
}

export function loadReport(): FitaiReport | null {
  try {
    const value = localStorage.getItem(REPORT_KEY);
    return value ? (JSON.parse(value) as FitaiReport) : null;
  } catch {
    return null;
  }
}