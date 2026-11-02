export type MotionState = 'SETUP' | 'EM_PÉ' | 'DESCENDO' | 'EMBAIXO' | 'SUBINDO' | 'FINALIZAÇÃO';
export type Point = { x: number; y: number; z?: number; visibility?: number; presence?: number };
export type ChecklistStatus = 'OK' | 'ATENÇÃO' | 'NÃO AVALIÁVEL';
export type DepthLabel = 'flexão estimada baixa' | 'flexão estimada intermediária' | 'flexão estimada alta' | 'não avaliável';
export type PhaseName = 'SETUP' | 'DESCIDA' | 'PROFUNDIDADE' | 'SUBIDA' | 'FINALIZAÇÃO';
export type TrackingStatus = 'tracking' | 'bodyNotDetected' | 'multiple' | 'incomplete';
export type TrackingReliabilityLevel = 'alta' | 'moderada' | 'baixa' | 'insuficiente';
export type TrackingQuality = {
  level: TrackingReliabilityLevel;
  landmarkCoverage: number | null;
  temporalContinuity: number | null;
  meanConfidence: number | null;
  validFrames: number;
  evaluatedCriteria: number;
};

export type SquatConfig = {
  confidenceThreshold: number;
  depthThreshold: number;
  parallelAngle: number;
  trunkAngleThreshold: number;
  hipAscentDifferenceThreshold: number;
  footAngleAttentionDegrees: number;
  velocityThreshold: number;
  minFramesForCriterion: number;
  targetDepth: 'approximatelyParallel' | 'belowParallel';
  standingAngle: number;
  descentAngle: number;
  bottomExitAngle: number;
  standingStableFrames: number;
  abortDescentStableFrames: number;
  completeRepStableFrames: number;
  frameMargin: number;
  maxFrameGapMs: number;
};

export const SQUAT_CONFIG: SquatConfig = {
  confidenceThreshold: 0.4,
  depthThreshold: 112,
  parallelAngle: 100,
  trunkAngleThreshold: 15,
  hipAscentDifferenceThreshold: 0.018,
  footAngleAttentionDegrees: 22,
  velocityThreshold: 0.003,
  minFramesForCriterion: 8,
  targetDepth: 'approximatelyParallel',
  standingAngle: 155,
  descentAngle: 148,
  bottomExitAngle: 122,
  standingStableFrames: 3,
  abortDescentStableFrames: 3,
  completeRepStableFrames: 2,
  frameMargin: 0.035,
  maxFrameGapMs: 250,
};

export type SquatFrameMetrics = {
  timestamp: number;
  phase: MotionState;
  kneeAngle: number;
  hipY: number;
  hipX: number;
  shoulderY: number;
  shoulderX: number;
  kneeX: number;
  ankleX: number;
  trunkAngle: number;
  thighAngleToHorizontal: number | null;
  footAngleToHorizontal: number | null;
  confidence: number;
  landmarkCoverage: number;
  sideUsed: 'left' | 'right';
};

export type ChecklistItem = {
  key: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
  feedback?: string;
};

export type ScoreBreakdown = {
  depth: number | null;
  control: number | null;
  trunk: number | null;
  coordination: number | null;
};

export type PhaseObservation = {
  phase: PhaseName;
  status: ChecklistStatus;
  durationMs: number | null;
  detail: string;
};

export type RepMetric = {
  id: number;
  minKneeAngle: number;
  thighAngleToHorizontal: number | null;
  depthLabel: DepthLabel;
  executionIndex: number | null;
  durationMs: number | null;
  trackingQuality: TrackingQuality;
  note: string;
  scoreBreakdown: ScoreBreakdown;
  checklist: ChecklistItem[];
  phaseAnalysis: PhaseObservation[];
  issues: string[];
  positives: string[];
  feedback: string[];
  trajectory: Array<{ x: number; y: number }>;
};

export type FitaiReport = {
  id: string;
  completedAt: string;
  durationMs: number;
  repetitions: RepMetric[];
  executionIndex: number | null;
  reliability: TrackingReliabilityLevel;
  trackingQuality: TrackingQuality;
  phaseAnalysis: PhaseObservation[];
  priorities: string[];
  positives: string[];
  limitations: string[];
  trend: 'improving' | 'declining' | 'stable' | 'insufficient';
  previousComparison: {
    previousIndex: number | null;
    currentIndex: number | null;
    indexDelta: number | null;
    message: string;
  } | null;
};

export const LANDMARK_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
];

export const REQUIRED_SIDE_LANDMARKS = [
  [11, 13, 15],
  [12, 14, 16],
  [23, 25, 27],
  [24, 26, 28],
] as const;
export const SQUAT_SIDE_LANDMARKS = {
  left: [11, 23, 25, 27],
  right: [12, 24, 26, 28],
} as const;
const HISTORY_KEY = 'fitai:reports';
const REPORT_KEY = 'fitai:last-report';

function scopedStorageKey(key: string, userId?: string) {
  return userId ? `${key}:${encodeURIComponent(userId)}` : key;
}

function migrateLegacyReports(userId?: string) {
  if (!userId) return;
  for (const key of [REPORT_KEY, HISTORY_KEY]) {
    const scopedKey = scopedStorageKey(key, userId);
    if (localStorage.getItem(scopedKey) !== null) continue;
    const legacyValue = localStorage.getItem(key);
    if (legacyValue === null) continue;
    localStorage.setItem(scopedKey, legacyValue);
    localStorage.removeItem(key);
  }
}

export function isLandmarkUsable(
  point: Point | undefined,
  confidenceThreshold = SQUAT_CONFIG.confidenceThreshold,
) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (
    point.visibility !== undefined &&
    (!Number.isFinite(point.visibility) || point.visibility < confidenceThreshold)
  ) return false;
  if (
    point.presence !== undefined &&
    (!Number.isFinite(point.presence) || point.presence < confidenceThreshold)
  ) return false;
  return true;
}

export function landmarkIsVisible(point?: Point, threshold = SQUAT_CONFIG.confidenceThreshold) {
  return isLandmarkUsable(point, threshold);
}

export function landmarkConfidence(point?: Point) {
  if (!point) return 0;
  const values = [point.visibility, point.presence]
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return values.length ? Math.min(...values) : 0;
}

export function hasCompleteSquatSide(pose: Point[]) {
  return Object.values(SQUAT_SIDE_LANDMARKS).some((landmarks) =>
    landmarks.every((index) => isLandmarkUsable(pose[index])),
  );
}

export function getTrackingStatus(poses: Point[][]): TrackingStatus {
  if (!poses.length) return 'bodyNotDetected';
  if (poses.length > 1) return 'multiple';
  return hasCompleteSquatSide(poses[0]) ? 'tracking' : 'incomplete';
}

function sideIsInFrame(pose: Point[], side: 'left' | 'right') {
  const essential = SQUAT_SIDE_LANDMARKS[side].map((index) => pose[index]);
  if (!essential.every((point) => isLandmarkUsable(point))) return false;

  const head = [pose[0], pose[7], pose[8]]
    .filter((point) => isLandmarkUsable(point))
    .sort((a, b) => landmarkConfidence(b) - landmarkConfidence(a))[0];
  const footIndexes = side === 'left' ? [29, 31] : [30, 32];
  const footPoints = footIndexes
    .map((index) => pose[index])
    .filter((point) => isLandmarkUsable(point));
  if (!head || !footPoints.length) return false;

  const visiblePoints = [...essential, head, ...footPoints];
  const margin = SQUAT_CONFIG.frameMargin;
  if (visiblePoints.some((point) => point.x < margin || point.x > 1 - margin)) return false;
  const headY = Math.min(head.y, ...essential.map((point) => point.y));
  const footY = Math.max(...footPoints.map((point) => point.y));
  return headY >= margin && footY <= 1 - margin && footY - headY >= 0.55;
}

export function isFullBodyVisible(pose: Point[]) {
  return (Object.keys(SQUAT_SIDE_LANDMARKS) as Array<'left' | 'right'>)
    .some((side) => sideIsInFrame(pose, side));
}

export function smoothLandmarks(previous: Point[] | null, next: Point[], alpha = 0.38) {
  if (!previous || previous.length !== next.length) {
    return next.map((point) => point ? { ...point } : point);
  }
  return next.map((point, index) => {
    const prior = previous[index];
    if (!point || !prior || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return point ? { ...point } : point;
    }
    return {
      ...point,
      x: prior.x + (point.x - prior.x) * alpha,
      y: prior.y + (point.y - prior.y) * alpha,
      z: (prior.z ?? 0) + ((point.z ?? 0) - (prior.z ?? 0)) * alpha,
      visibility: point.visibility,
      presence: point.presence,
    };
  });
}

export function angleAtVertex(a: Point, b: Point, c: Point): number | null {
  if (![a, b, c].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magnitude = Math.sqrt(ab.x ** 2 + ab.y ** 2) * Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (!Number.isFinite(magnitude) || magnitude < 1e-6) return null;
  return Math.round((Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) * 180) / Math.PI);
}

export function angleBetweenSegmentAndHorizontal(a: Point, b: Point): number | null {
  if (![a, b].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.round((Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI);
}

function trunkAngle(shoulder: Point, hip: Point) {
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.round((Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI);
}

type SideMetrics = {
  side: 'left' | 'right';
  kneeAngle: number;
  hipY: number;
  hipX: number;
  shoulderY: number;
  shoulderX: number;
  kneeX: number;
  ankleX: number;
  trunkAngle: number;
  thighAngleToHorizontal: number | null;
  footAngleToHorizontal: number | null;
  confidence: number;
};

function sideMetrics(pose: Point[], side: 'left' | 'right'): SideMetrics | null {
  const indexes = side === 'left'
    ? { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 }
    : { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
  const shoulder = pose[indexes.shoulder];
  const hip = pose[indexes.hip];
  const knee = pose[indexes.knee];
  const ankle = pose[indexes.ankle];
  if (![shoulder, hip, knee, ankle].every((point) => isLandmarkUsable(point))) return null;
  const kneeAngle = angleAtVertex(hip, knee, ankle);
  const trunk = trunkAngle(shoulder, hip);
  if (kneeAngle === null || trunk === null) return null;
  const heel = pose[indexes.heel];
  const toe = pose[indexes.toe];
  const footIsVisible = isLandmarkUsable(heel) && isLandmarkUsable(toe);
  return {
    side,
    kneeAngle,
    hipY: hip.y,
    hipX: hip.x,
    shoulderY: shoulder.y,
    shoulderX: shoulder.x,
    kneeX: knee.x,
    ankleX: ankle.x,
    trunkAngle: trunk,
    thighAngleToHorizontal: angleBetweenSegmentAndHorizontal(hip, knee),
    footAngleToHorizontal: footIsVisible ? angleBetweenSegmentAndHorizontal(heel, toe) : null,
    confidence: [shoulder, hip, knee, ankle].reduce((sum, point) => sum + landmarkConfidence(point), 0) / 4,
  };
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getSquatMetrics(pose: Point[]): SquatFrameMetrics | null {
  const left = sideMetrics(pose, 'left');
  const right = sideMetrics(pose, 'right');
  const side = [left, right]
    .filter((candidate): candidate is SideMetrics => Boolean(candidate))
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (!side) return null;
  return {
    timestamp: 0,
    phase: 'SETUP',
    kneeAngle: side.kneeAngle,
    hipY: side.hipY,
    hipX: side.hipX,
    shoulderY: side.shoulderY,
    shoulderX: side.shoulderX,
    kneeX: side.kneeX,
    ankleX: side.ankleX,
    trunkAngle: side.trunkAngle,
    thighAngleToHorizontal: side.thighAngleToHorizontal,
    footAngleToHorizontal: side.footAngleToHorizontal,
    confidence: side.confidence,
    landmarkCoverage: 1,
    sideUsed: side.side,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function validDuration(frames: SquatFrameMetrics[]) {
  if (frames.length < 2) return null;
  const timestamps = frames.map((frame) => frame.timestamp);
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) return null;
  if (timestamps.some((timestamp, index) => index > 0 && timestamp <= timestamps[index - 1])) return null;
  return timestamps[timestamps.length - 1] - timestamps[0];
}

function phaseDuration(frames: SquatFrameMetrics[], phases: MotionState[]) {
  const phaseFrames = frames.filter((frame) => phases.includes(frame.phase));
  return validDuration(phaseFrames);
}

function depthLabel(minKneeAngle: number, frameCount: number): DepthLabel {
  if (frameCount < SQUAT_CONFIG.minFramesForCriterion) return 'não avaliável';
  if (minKneeAngle > SQUAT_CONFIG.depthThreshold) return 'flexão estimada baixa';
  if (minKneeAngle > SQUAT_CONFIG.parallelAngle) return 'flexão estimada intermediária';
  return 'flexão estimada alta';
}

function checklistItem(key: string, label: string, status: ChecklistStatus, detail: string, feedback?: string): ChecklistItem {
  return { key, label, status, detail, feedback };
}

function statusDetail(status: ChecklistStatus, ok: string, attention: string, unavailable: string) {
  return status === 'OK' ? ok : status === 'ATENÇÃO' ? attention : unavailable;
}

function trackingQualityForFrames(frames: SquatFrameMetrics[], evaluatedCriteria: number): TrackingQuality {
  const validFrames = frames.filter((frame) =>
    Number.isFinite(frame.timestamp) &&
    Number.isFinite(frame.confidence) &&
    Number.isFinite(frame.landmarkCoverage),
  );
  const meanConfidence = validFrames.length
    ? mean(validFrames.map((frame) => clamp(frame.confidence, 0, 1)))
    : null;
  const landmarkCoverage = validFrames.length
    ? mean(validFrames.map((frame) => clamp(frame.landmarkCoverage, 0, 1)))
    : null;
  const intervals = validFrames.slice(1).map((frame, index) => frame.timestamp - validFrames[index].timestamp);
  const temporalContinuity = intervals.length && intervals.every((interval) => interval > 0)
    ? intervals.filter((interval) => interval <= SQUAT_CONFIG.maxFrameGapMs).length / intervals.length
    : null;
  const level: TrackingReliabilityLevel =
    validFrames.length < SQUAT_CONFIG.minFramesForCriterion ||
    meanConfidence === null ||
    landmarkCoverage === null ||
    temporalContinuity === null
      ? 'insuficiente'
      : landmarkCoverage >= 0.95 && temporalContinuity >= 0.9 && meanConfidence >= 0.75 && evaluatedCriteria >= 2
        ? 'alta'
        : landmarkCoverage >= 0.8 && temporalContinuity >= 0.7 && meanConfidence >= 0.55
          ? 'moderada'
          : 'baixa';
  return {
    level,
    landmarkCoverage,
    temporalContinuity,
    meanConfidence,
    validFrames: validFrames.length,
    evaluatedCriteria,
  };
}

export function summarizeTrackingQuality(repetitions: RepMetric[]): TrackingQuality {
  const qualities = repetitions.map((rep) => rep.trackingQuality).filter(Boolean);
  if (!qualities.length) {
    return {
      level: 'insuficiente',
      landmarkCoverage: null,
      temporalContinuity: null,
      meanConfidence: null,
      validFrames: 0,
      evaluatedCriteria: 0,
    };
  }
  const averageAvailable = (values: Array<number | null>) => {
    const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return valid.length ? mean(valid) : null;
  };
  const validFrames = qualities.reduce((sum, quality) => sum + quality.validFrames, 0);
  const evaluatedCriteria = qualities.reduce((sum, quality) => sum + quality.evaluatedCriteria, 0);
  const landmarkCoverage = averageAvailable(qualities.map((quality) => quality.landmarkCoverage));
  const temporalContinuity = averageAvailable(qualities.map((quality) => quality.temporalContinuity));
  const meanConfidence = averageAvailable(qualities.map((quality) => quality.meanConfidence));
  const level: TrackingReliabilityLevel =
    validFrames < SQUAT_CONFIG.minFramesForCriterion ||
    landmarkCoverage === null ||
    temporalContinuity === null ||
    meanConfidence === null
      ? 'insuficiente'
      : landmarkCoverage >= 0.95 && temporalContinuity >= 0.9 && meanConfidence >= 0.75 && evaluatedCriteria >= 2
        ? 'alta'
        : landmarkCoverage >= 0.8 && temporalContinuity >= 0.7 && meanConfidence >= 0.55
          ? 'moderada'
          : 'baixa';
  return { level, landmarkCoverage, temporalContinuity, meanConfidence, validFrames, evaluatedCriteria };
}

function buildRepMetric(id: number, frames: SquatFrameMetrics[], baselineTrunkAngle: number | null): RepMetric {
  const minKneeAngle = Math.min(...frames.map((frame) => frame.kneeAngle));
  const durationMs = validDuration(frames);
  const enoughFrames = frames.length >= SQUAT_CONFIG.minFramesForCriterion && durationMs !== null;
  const label = depthLabel(minKneeAngle, enoughFrames ? frames.length : 0);
  const bottomFrame = [...frames].sort((a, b) => a.kneeAngle - b.kneeAngle)[0];
  const trunkReference = baselineTrunkAngle ?? frames[0]?.trunkAngle ?? null;
  const trunkReferenceValue = trunkReference ?? 0;
  const maxTrunkChange = Math.max(...frames.map((frame) => Math.abs(frame.trunkAngle - trunkReferenceValue)));
  const ascent = frames.filter((frame) => frame.phase === 'SUBINDO' || frame.phase === 'FINALIZAÇÃO');
  const descent = frames.filter((frame) => frame.phase === 'DESCENDO');
  const descentDuration = phaseDuration(frames, ['DESCENDO']);
  const ascentDuration = phaseDuration(frames, ['SUBINDO', 'FINALIZAÇÃO']);
  const footFrames = frames.filter((frame) => frame.footAngleToHorizontal !== null);
  const maxFootAngle = footFrames.length
    ? Math.max(...footFrames.map((frame) => frame.footAngleToHorizontal as number))
    : null;
  const footStatus: ChecklistStatus = footFrames.length < SQUAT_CONFIG.minFramesForCriterion || maxFootAngle === null
    ? 'NÃO AVALIÁVEL'
    : maxFootAngle > SQUAT_CONFIG.footAngleAttentionDegrees
      ? 'ATENÇÃO'
      : 'OK';
  const targetAngle = SQUAT_CONFIG.targetDepth === 'approximatelyParallel'
    ? SQUAT_CONFIG.depthThreshold
    : SQUAT_CONFIG.parallelAngle;
  const depthStatus: ChecklistStatus = label === 'não avaliável'
    ? 'NÃO AVALIÁVEL'
    : minKneeAngle > targetAngle
      ? 'ATENÇÃO'
      : 'OK';
  const descentReversals = descent.slice(1).filter((frame, index) =>
    frame.hipY < descent[index].hipY - SQUAT_CONFIG.velocityThreshold,
  ).length;
  const controlEvaluable = descent.length >= 4 && descentDuration !== null && enoughFrames;
  const controlStatus: ChecklistStatus = !controlEvaluable
    ? 'NÃO AVALIÁVEL'
    : descentReversals >= 2
      ? 'ATENÇÃO'
      : 'OK';
  const trunkStatus: ChecklistStatus = !enoughFrames || trunkReference === null
    ? 'NÃO AVALIÁVEL'
    : maxTrunkChange > SQUAT_CONFIG.trunkAngleThreshold
      ? 'ATENÇÃO'
      : 'OK';
  const hipStarts = ascent.findIndex((frame, index) => index > 0 && frame.hipY < ascent[Math.max(0, index - 1)].hipY - SQUAT_CONFIG.hipAscentDifferenceThreshold);
  const shoulderStarts = ascent.findIndex((frame, index) => index > 0 && frame.shoulderY < ascent[Math.max(0, index - 1)].shoulderY - SQUAT_CONFIG.hipAscentDifferenceThreshold);
  const syncStatus: ChecklistStatus = !ascent.length || hipStarts < 0 || shoulderStarts < 0 ? 'NÃO AVALIÁVEL' : hipStarts - shoulderStarts > 2 ? 'ATENÇÃO' : 'OK';
  const finalFrame = frames[frames.length - 1];
  const finishStatus: ChecklistStatus = !finalFrame || !enoughFrames || trunkReference === null
    ? 'NÃO AVALIÁVEL'
    : Math.abs(finalFrame.trunkAngle - trunkReference) > SQUAT_CONFIG.trunkAngleThreshold
      ? 'ATENÇÃO'
      : 'OK';
  const issues: string[] = [];
  const feedback: string[] = [];
  const positives: string[] = [];
  if (footStatus === 'ATENÇÃO') {
    issues.push('Inclinação visual do pé variou acima do limite estimado');
    feedback.push('A imagem 2D mostrou variação na orientação do pé. Confira o posicionamento diretamente; isto não confirma contato ou perda de apoio no solo.');
  }
  if (depthStatus === 'ATENÇÃO') {
    issues.push('Flexão estimada do joelho abaixo da faixa configurada');
    feedback.push('A estimativa angular do joelho ficou acima da faixa configurada. A câmera 2D não comprova a altura da coxa nem uma profundidade física.');
  }
  if (trunkStatus === 'ATENÇÃO') {
    issues.push('Mudança observada na inclinação 2D do tronco');
    feedback.push('A orientação 2D entre ombro e quadril variou em relação ao início. Isso não mede neutralidade da coluna vertebral.');
  }
  if (syncStatus === 'ATENÇÃO') {
    issues.push('Início da subida pareceu dessincronizado em 2D');
    feedback.push('A trajetória estimada de ombro e quadril começou em momentos diferentes. Revise o vídeo; a leitura não é uma avaliação clínica.');
  }
  if (finishStatus === 'ATENÇÃO') {
    issues.push('Inclinação do tronco no final diferiu do início');
    feedback.push('A posição 2D de ombro e quadril no final diferiu do começo. Isso não identifica movimento pélvico ou neutralidade da coluna.');
  }
  if (footStatus === 'OK') positives.push('A orientação visual do pé variou pouco nos frames avaliáveis.');
  if (depthStatus === 'OK') positives.push('A estimativa angular do joelho atingiu a faixa configurada.');
  if (trunkStatus === 'OK') positives.push('A inclinação 2D de ombro-quadril variou pouco nesta repetição.');
  if (syncStatus === 'OK') positives.push('O início da subida de ombro e quadril foi semelhante na estimativa 2D.');
  if (controlStatus === 'OK') positives.push('Poucas reversões verticais foram observadas na trajetória 2D da descida.');
  const depthScore = label === 'não avaliável' ? null : clamp(100 - Math.abs(minKneeAngle - targetAngle) * 2, 0, 100);
  const controlScore = !controlEvaluable ? null : clamp(100 - descentReversals * 35, 0, 100);
  const trunkScore = !enoughFrames || trunkReference === null ? null : clamp(100 - maxTrunkChange * 3, 0, 100);
  const coordinationScore = syncStatus === 'NÃO AVALIÁVEL' ? null : syncStatus === 'ATENÇÃO' ? 60 : 100;
  const scoreValues = [depthScore, controlScore, trunkScore, coordinationScore].filter((value): value is number => value !== null);
  const executionIndex = scoreValues.length >= 2 ? Math.round(mean(scoreValues)) : null;
  const trackingQuality = trackingQualityForFrames(frames, scoreValues.length);
  const note = issues[0] ?? (
    executionIndex === null
      ? 'Índice não calculado: poucos critérios avaliáveis'
      : positives[0] ?? 'Movimento acompanhado sem alerta conclusivo'
  );
  return {
    id,
    minKneeAngle: Math.round(minKneeAngle),
    thighAngleToHorizontal: bottomFrame?.thighAngleToHorizontal ?? null,
    depthLabel: label,
    executionIndex,
    durationMs,
    trackingQuality,
    note,
    scoreBreakdown: {
      depth: depthScore === null ? null : Math.round(depthScore),
      control: controlScore === null ? null : Math.round(controlScore),
      trunk: trunkScore === null ? null : Math.round(trunkScore),
      coordination: coordinationScore,
    },
    checklist: [
      checklistItem('support', 'Orientação visual do pé', footStatus, statusDetail(footStatus, `Inclinação estimada calcanhar-ponta de até ${Math.round(maxFootAngle ?? 0)}° em 2D; não confirma apoio no solo.`, `Foi estimada inclinação calcanhar-ponta acima de ${SQUAT_CONFIG.footAngleAttentionDegrees}° em 2D; não confirma perda de contato.`, 'Calcanhar e ponta não foram visíveis em frames suficientes.'), feedback.find((message) => message.includes('orientação 2D'))),
      checklistItem('descent', 'Regularidade visual da descida', controlStatus, statusDetail(controlStatus, 'Poucas reversões verticais acima do limite de ruído foram observadas; isto não prova qualidade técnica.', 'Foram observadas reversões verticais na trajetória 2D; revise o vídeo.', 'Não houve timestamps monotônicos ou frames suficientes para estimar a trajetória.'), controlStatus === 'ATENÇÃO' ? 'Confira a trajetória no vídeo; não é uma conclusão clínica.' : undefined),
      checklistItem('depth', 'Flexão angular estimada', depthStatus, statusDetail(depthStatus, `Joelho: ${label}. Estimativa 2D; não confirma paralelismo da coxa.`, `Joelho: ${label}. A faixa configurada não foi atingida.`, 'Não houve frames suficientes para estimar o ângulo do joelho.'), feedback.find((message) => message.includes('estimativa angular'))),
      checklistItem('trunk', 'Inclinação 2D do tronco', trunkStatus, statusDetail(trunkStatus, 'A orientação 2D entre ombro e quadril variou pouco em relação ao início; não mede neutralidade da coluna.', 'A inclinação 2D entre ombro e quadril mudou acima do limite configurado.', 'Não houve frames suficientes para comparar ombro e quadril.'), feedback.find((message) => message.includes('orientação 2D'))),
      checklistItem('rise', 'Início da subida (estimativa 2D)', syncStatus, statusDetail(syncStatus, 'O início observado para ombro e quadril foi semelhante.', 'Os pontos começaram a subir em momentos diferentes; revise o vídeo.', 'Não foi possível comparar os inícios de movimento.'), feedback.find((message) => message.includes('trajetória estimada'))),
      checklistItem('finish', 'Posição 2D no final', finishStatus, statusDetail(finishStatus, 'A inclinação de ombro-quadril no final ficou próxima à referência inicial.', 'A inclinação de ombro-quadril no final diferiu da referência inicial.', 'Não houve dados suficientes da posição final.'), feedback.find((message) => message.includes('posição 2D'))),
    ],
    phaseAnalysis: [
      { phase: 'SETUP', status: baselineTrunkAngle === null ? 'NÃO AVALIÁVEL' : 'OK', durationMs: null, detail: baselineTrunkAngle === null ? 'Não foi possível formar um baseline confiável.' : 'Baseline do tronco registrado.' },
      { phase: 'DESCIDA', status: controlStatus, durationMs: descentDuration, detail: descentDuration === null ? 'Não há timestamps monotônicos e frames suficientes para medir duração.' : `Duração observada: ${Math.round(descentDuration)} ms. A regularidade é apenas uma estimativa de trajetória 2D.` },
      { phase: 'PROFUNDIDADE', status: depthStatus, durationMs: phaseDuration(frames, ['EMBAIXO']), detail: label === 'não avaliável' ? 'O ângulo do joelho não pôde ser estimado com frames suficientes.' : `Flexão estimada do joelho: ${label}; a orientação da coxa é ${bottomFrame?.thighAngleToHorizontal === null || bottomFrame?.thighAngleToHorizontal === undefined ? 'não avaliável' : `${Math.round(bottomFrame.thighAngleToHorizontal)}° em relação à horizontal`}. Isto não confirma paralelismo físico.` },
      { phase: 'SUBIDA', status: ascentDuration === null ? 'NÃO AVALIÁVEL' : syncStatus, durationMs: ascentDuration, detail: syncStatus === 'ATENÇÃO' ? 'Quadril iniciou antes do tronco.' : syncStatus === 'OK' ? 'Subida coordenada.' : 'Não houve dados suficientes para comparar.' },
      { phase: 'FINALIZAÇÃO', status: finishStatus, durationMs: phaseDuration(frames, ['FINALIZAÇÃO']), detail: finishStatus === 'ATENÇÃO' ? 'Inclinação 2D de ombro-quadril no final diferiu do início.' : finishStatus === 'OK' ? 'Inclinação 2D de ombro-quadril no final ficou próxima à referência inicial.' : 'Posição final não foi avaliável.' },
    ],
    issues,
    positives,
    feedback,
    trajectory: frames.map((frame) => ({ x: frame.hipX, y: frame.hipY })),
  };
}

export function makeRepMetric(id: number, minKneeAngle: number, durationMs: number, frames: SquatFrameMetrics[] = [], baselineTrunkAngle: number | null = null): RepMetric {
  if (frames.length >= 2) return buildRepMetric(id, frames, baselineTrunkAngle);
  const depthLabel: DepthLabel = 'não avaliável';
  return {
    id,
    minKneeAngle: Number.isFinite(minKneeAngle) ? Math.round(minKneeAngle) : 0,
    thighAngleToHorizontal: null,
    depthLabel,
    executionIndex: null,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
    trackingQuality: trackingQualityForFrames(frames, 0),
    note: 'Análise não pontuada: faltam frames válidos para avaliar a repetição.',
    scoreBreakdown: { depth: null, control: null, trunk: null, coordination: null },
    checklist: [],
    phaseAnalysis: [],
    issues: [],
    positives: [],
    feedback: [],
    trajectory: [],
  };
}

export type TrackerUpdate = {
  trackingStatus: TrackingStatus;
  displayStatus: TrackingStatus;
  pose: Point[] | null;
  frame: SquatFrameMetrics | null;
  motionState: MotionState;
  landmarkCount: number;
  completedRep: RepMetric | null;
  repetitions: RepMetric[];
};

/**
 * Shared squat state machine for live camera and recorded-video validation.
 * Incomplete tracking clears only the in-progress repetition; completed reps remain.
 */
export class SquatRepTracker {
  private previousLandmarks: Point[] | null = null;
  private motionState: MotionState = 'SETUP';
  private currentRepFrames: SquatFrameMetrics[] = [];
  private descentCandidateFrames: SquatFrameMetrics[] = [];
  private standingCandidateFrames = 0;
  private baselineTrunkAngle: number | null = null;
  private minKneeAngle = 180;
  private repetitions: RepMetric[] = [];
  private lastTimestamp: number | null = null;

  reset() {
    this.repetitions = [];
    this.resetMotion();
  }

  resetMotion() {
    this.previousLandmarks = null;
    this.motionState = 'SETUP';
    this.currentRepFrames = [];
    this.descentCandidateFrames = [];
    this.standingCandidateFrames = 0;
    this.baselineTrunkAngle = null;
    this.minKneeAngle = 180;
    this.lastTimestamp = null;
  }

  handleTrackingLoss() {
    this.resetMotion();
  }

  getRepetitions() {
    return [...this.repetitions];
  }

  processPose(poses: Point[][], timestamp: number): TrackerUpdate {
    const trackingStatus = getTrackingStatus(poses);
    const visiblePose = poses.length === 1 ? poses[0] : null;
    const landmarkCount = visiblePose
      ? visiblePose.filter((point) => point && landmarkIsVisible(point)).length
      : 0;
    const displayStatus =
      trackingStatus === 'tracking' && visiblePose && !isFullBodyVisible(visiblePose)
        ? 'incomplete'
        : trackingStatus;

    const timestampIsMonotonic =
      Number.isFinite(timestamp) &&
      (this.lastTimestamp === null || timestamp > this.lastTimestamp);
    if (trackingStatus !== 'tracking' || displayStatus !== 'tracking' || !visiblePose || !timestampIsMonotonic) {
      this.handleTrackingLoss();
      return {
        trackingStatus: timestampIsMonotonic ? trackingStatus : 'incomplete',
        displayStatus: timestampIsMonotonic ? displayStatus : 'incomplete',
        pose: visiblePose,
        frame: null,
        motionState: this.motionState,
        landmarkCount,
        completedRep: null,
        repetitions: this.getRepetitions(),
      };
    }

    this.lastTimestamp = timestamp;
    const pose = smoothLandmarks(this.previousLandmarks, visiblePose);
    this.previousLandmarks = pose;
    const frame = getSquatMetrics(pose);
    if (!frame) {
      this.handleTrackingLoss();
      return {
        trackingStatus,
        displayStatus,
        pose: null,
        frame: null,
        motionState: this.motionState,
        landmarkCount,
        completedRep: null,
        repetitions: this.getRepetitions(),
      };
    }

    frame.timestamp = timestamp;
    frame.phase = this.motionState;
    // Use the current raw pose angle for phase transitions. Smoothing remains
    // valuable for reported metrics, but it can lag enough to miss a fast return
    // to standing if the athlete immediately begins the next repetition.
    const stateAngle = getSquatMetrics(visiblePose)?.kneeAngle ?? frame.kneeAngle;
    if (this.motionState === 'SETUP') {
      this.baselineTrunkAngle =
        this.baselineTrunkAngle === null
          ? frame.trunkAngle
          : this.baselineTrunkAngle * 0.9 + frame.trunkAngle * 0.1;
    }

    const repsBeforeFrame = this.repetitions.length;
    const motion = this.motionState;
    if (motion === 'SETUP') {
      if (stateAngle >= SQUAT_CONFIG.standingAngle) {
        this.standingCandidateFrames += 1;
        if (this.standingCandidateFrames >= SQUAT_CONFIG.standingStableFrames) {
          this.motionState = 'EM_PÉ';
          this.standingCandidateFrames = 0;
        }
      } else {
        this.standingCandidateFrames = 0;
      }
    } else if (motion === 'EM_PÉ') {
      if (stateAngle <= SQUAT_CONFIG.descentAngle) {
        frame.phase = 'DESCENDO';
        this.descentCandidateFrames.push(frame);
        if (this.descentCandidateFrames.length >= 2) {
          this.currentRepFrames = this.descentCandidateFrames;
          this.descentCandidateFrames = [];
          this.minKneeAngle = Math.min(...this.currentRepFrames.map((item) => item.kneeAngle));
          this.motionState = 'DESCENDO';
        }
      } else {
        this.descentCandidateFrames = [];
      }
    } else if (motion === 'DESCENDO') {
      frame.phase = 'DESCENDO';
      this.currentRepFrames.push(frame);
      this.minKneeAngle = Math.min(this.minKneeAngle, frame.kneeAngle);
      if (stateAngle <= SQUAT_CONFIG.depthThreshold) {
        this.motionState = 'EMBAIXO';
        this.standingCandidateFrames = 0;
      } else if (stateAngle >= SQUAT_CONFIG.standingAngle) {
        this.standingCandidateFrames += 1;
        if (this.standingCandidateFrames >= SQUAT_CONFIG.abortDescentStableFrames) {
          this.currentRepFrames = [];
          this.minKneeAngle = 180;
          this.motionState = 'EM_PÉ';
          this.standingCandidateFrames = 0;
        }
      } else {
        this.standingCandidateFrames = 0;
      }
    } else if (motion === 'EMBAIXO') {
      frame.phase = 'EMBAIXO';
      this.currentRepFrames.push(frame);
      this.minKneeAngle = Math.min(this.minKneeAngle, frame.kneeAngle);
      if (stateAngle >= SQUAT_CONFIG.bottomExitAngle) {
        this.motionState = 'SUBINDO';
      }
    } else if (motion === 'SUBINDO') {
      const hasReturnedToStanding = stateAngle >= SQUAT_CONFIG.standingAngle;
      frame.phase = hasReturnedToStanding ? 'FINALIZAÇÃO' : 'SUBINDO';
      this.currentRepFrames.push(frame);
      if (hasReturnedToStanding) {
        this.standingCandidateFrames += 1;
        if (this.standingCandidateFrames >= SQUAT_CONFIG.completeRepStableFrames) {
          const elapsed = validDuration(this.currentRepFrames);
          this.repetitions = [
            ...this.repetitions,
            makeRepMetric(
              this.repetitions.length + 1,
              this.minKneeAngle,
              elapsed ?? 0,
              this.currentRepFrames,
              this.baselineTrunkAngle,
            ),
          ];
          this.currentRepFrames = [];
          this.minKneeAngle = 180;
          this.motionState = 'EM_PÉ';
          this.standingCandidateFrames = 0;
        }
      } else {
        this.standingCandidateFrames = 0;
        if (stateAngle <= SQUAT_CONFIG.depthThreshold) {
          this.motionState = 'EMBAIXO';
        }
      }
    }

    const currentReps = this.getRepetitions();
    return {
      trackingStatus,
      displayStatus,
      pose,
      frame,
      motionState: this.motionState,
      landmarkCount,
      completedRep:
        this.repetitions.length > repsBeforeFrame
          ? currentReps[currentReps.length - 1]
          : null,
      repetitions: currentReps,
    };
  }
}

export function averageExecutionIndex(repetitions: RepMetric[]) {
  const values = repetitions
    .map((rep) => rep.executionIndex)
    .filter((value): value is number => value !== null);
  return values.length ? Math.round(mean(values)) : null;
}

export function summarizeRepetitions(repetitions: RepMetric[]) {
  const issues = new Map<string, number>();
  const positives = new Map<string, number>();
  repetitions.forEach((rep) => {
    rep.issues.forEach((issue) => issues.set(issue, (issues.get(issue) ?? 0) + 1));
    rep.positives.forEach((positive) => positives.set(positive, (positives.get(positive) ?? 0) + 1));
  });
  const priorityMessages: Record<string, string> = {
    'Flexão estimada do joelho abaixo da faixa configurada': 'Confira visualmente a faixa angular indicada; não é uma medida de profundidade física.',
    'Início da subida pareceu dessincronizado em 2D': 'Revise o vídeo para conferir a trajetória de ombro e quadril.',
    'Inclinação visual do pé variou acima do limite estimado': 'Confira o posicionamento do pé diretamente; a câmera não confirma contato com o solo.',
    'Mudança observada na inclinação 2D do tronco': 'Revise a orientação 2D de ombro e quadril; ela não mede a coluna.',
    'Inclinação do tronco no final diferiu do início': 'Revise a posição no vídeo; isto não mede movimento pélvico ou coluna.',
  };
  const priorities = [...issues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue, count]) => `${issue} · ${count} de ${repetitions.length} repetições. ${priorityMessages[issue] ?? 'Revise este padrão na próxima execução.'}`);
  return {
    priorities,
    positives: [...positives.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([positive, count]) => `${positive} (${count} de ${repetitions.length} repetições)`),
  };
}

export function buildPhaseSummary(repetitions: RepMetric[]): PhaseObservation[] {
  const phases: PhaseName[] = ['SETUP', 'DESCIDA', 'PROFUNDIDADE', 'SUBIDA', 'FINALIZAÇÃO'];
  return phases.map((phase) => {
    const observations = repetitions
      .map((rep) => rep.phaseAnalysis.find((item) => item.phase === phase))
      .filter((item): item is PhaseObservation => Boolean(item));
    const evaluated = observations.filter((item) => item.status !== 'NÃO AVALIÁVEL');
    const attention = evaluated.filter((item) => item.status === 'ATENÇÃO').length;
    return {
      phase,
      status: !evaluated.length ? 'NÃO AVALIÁVEL' : attention ? 'ATENÇÃO' : 'OK',
      durationMs: null,
      detail: !evaluated.length ? 'Não foi possível avaliar esta fase.' : attention ? `${attention} de ${evaluated.length} repetições tiveram um alerta nesta fase.` : `Fase consistente em ${evaluated.length} repetições avaliáveis.`,
    };
  });
}

export function compareReports(current: FitaiReport, previous: FitaiReport | null) {
  if (!previous || current.executionIndex === null || previous.executionIndex === null) return null;
  const indexDelta = current.executionIndex - previous.executionIndex;
  return {
    previousIndex: previous.executionIndex,
    currentIndex: current.executionIndex,
    indexDelta,
    message: indexDelta > 2 ? 'Seu índice experimental aumentou em relação ao treino anterior.' : indexDelta < -2 ? 'Seu índice experimental ficou abaixo do treino anterior.' : 'Seu índice experimental ficou próximo do treino anterior.',
  };
}

export function saveReport(report: FitaiReport, userId?: string) {
  migrateLegacyReports(userId);
  const history = loadHistory(userId);
  localStorage.setItem(scopedStorageKey(REPORT_KEY, userId), JSON.stringify(report));
  localStorage.setItem(scopedStorageKey(HISTORY_KEY, userId), JSON.stringify([report, ...history.filter((item) => item.id !== report.id)].slice(0, 20)));
}

export function loadReport(userId?: string): FitaiReport | null {
  try {
    migrateLegacyReports(userId);
    const value = localStorage.getItem(scopedStorageKey(REPORT_KEY, userId));
    return value ? (JSON.parse(value) as FitaiReport) : null;
  } catch {
    return null;
  }
}

export function loadHistory(userId?: string): FitaiReport[] {
  try {
    migrateLegacyReports(userId);
    const value = localStorage.getItem(scopedStorageKey(HISTORY_KEY, userId));
    return value ? (JSON.parse(value) as FitaiReport[]) : [];
  } catch {
    return [];
  }
}

export function clearReport(userId?: string) {
  localStorage.removeItem(scopedStorageKey(REPORT_KEY, userId));
}