export type MotionState = 'SETUP' | 'EM_PÉ' | 'DESCENDO' | 'EMBAIXO' | 'SUBINDO' | 'FINALIZAÇÃO';
export type Point = { x: number; y: number; z?: number; visibility?: number };
export type ChecklistStatus = 'OK' | 'ATENÇÃO' | 'NÃO AVALIÁVEL';
export type DepthLabel = 'acima da paralela' | 'aproximadamente paralelo' | 'abaixo da paralela' | 'não avaliável';
export type PhaseName = 'SETUP' | 'DESCIDA' | 'PROFUNDIDADE' | 'SUBIDA' | 'FINALIZAÇÃO';
export type TrackingStatus = 'tracking' | 'bodyNotDetected' | 'multiple' | 'incomplete';

export type SquatConfig = {
  confidenceThreshold: number;
  depthThreshold: number;
  parallelAngle: number;
  trunkAngleThreshold: number;
  hipAscentDifferenceThreshold: number;
  heelContactThreshold: number;
  velocityThreshold: number;
  minFramesForCriterion: number;
  targetDepth: 'approximatelyParallel' | 'belowParallel';
};

export const SQUAT_CONFIG: SquatConfig = {
  confidenceThreshold: 0.58,
  depthThreshold: 112,
  parallelAngle: 100,
  trunkAngleThreshold: 15,
  hipAscentDifferenceThreshold: 0.018,
  heelContactThreshold: 0.035,
  velocityThreshold: 0.003,
  minFramesForCriterion: 8,
  targetDepth: 'approximatelyParallel',
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
  heelContact: boolean | null;
  confidence: number;
  sideUsed: 'left' | 'right' | 'both';
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
  depthPercent: number;
  depthLabel: DepthLabel;
  executionIndex: number;
  durationMs: number;
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
  reliability: 'reliable' | 'insufficient';
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

const REQUIRED_SIDE_LANDMARKS = [[11, 23, 25, 27], [12, 24, 26, 28]];
const HISTORY_KEY = 'fitai:reports';
const REPORT_KEY = 'fitai:last-report';

export function landmarkIsVisible(point?: Point, threshold = SQUAT_CONFIG.confidenceThreshold) {
  return Boolean(point && (point.visibility === undefined || point.visibility >= threshold));
}

export function landmarkConfidence(point?: Point) {
  return point?.visibility ?? 1;
}

export function getTrackingStatus(poses: Point[][]): TrackingStatus {
  if (!poses.length) return 'bodyNotDetected';
  if (poses.length > 1) return 'multiple';
  const pose = poses[0];
  const sideReady = REQUIRED_SIDE_LANDMARKS.some((side) => side.every((index) => landmarkIsVisible(pose[index])));
  return sideReady ? 'tracking' : 'incomplete';
}

export function isFullBodyVisible(pose: Point[]) {
  const visible = pose
    .filter((point, index) => index >= 11 && point && landmarkIsVisible(point))
    .map((point) => point.y);
  return visible.length >= 6 && Math.min(...visible) <= 0.14 && Math.max(...visible) >= 0.84;
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

function trunkAngle(shoulder: Point, hip: Point) {
  return Math.round((Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180) / Math.PI);
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
  heelContact: boolean | null;
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
  if (![shoulder, hip, knee, ankle].every((point) => landmarkIsVisible(point))) return null;
  const heel = pose[indexes.heel];
  const toe = pose[indexes.toe];
  const footIsVisible = landmarkIsVisible(heel) && landmarkIsVisible(toe);
  return {
    side,
    kneeAngle: angleAtVertex(hip, knee, ankle),
    hipY: hip.y,
    hipX: hip.x,
    shoulderY: shoulder.y,
    shoulderX: shoulder.x,
    kneeX: knee.x,
    ankleX: ankle.x,
    trunkAngle: trunkAngle(shoulder, hip),
    heelContact: footIsVisible ? heel.y >= toe.y - SQUAT_CONFIG.heelContactThreshold : null,
    confidence: [shoulder, hip, knee, ankle].reduce((sum, point) => sum + landmarkConfidence(point), 0) / 4,
  };
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getSquatMetrics(pose: Point[]): SquatFrameMetrics | null {
  const left = sideMetrics(pose, 'left');
  const right = sideMetrics(pose, 'right');
  if (!left && !right) return null;
  const sides = [left, right].filter((side): side is SideMetrics => Boolean(side));
  const footStates = sides.map((side) => side.heelContact).filter((value): value is boolean => value !== null);
  return {
    timestamp: 0,
    phase: 'SETUP',
    kneeAngle: mean(sides.map((side) => side.kneeAngle)),
    hipY: mean(sides.map((side) => side.hipY)),
    hipX: mean(sides.map((side) => side.hipX)),
    shoulderY: mean(sides.map((side) => side.shoulderY)),
    shoulderX: mean(sides.map((side) => side.shoulderX)),
    kneeX: mean(sides.map((side) => side.kneeX)),
    ankleX: mean(sides.map((side) => side.ankleX)),
    trunkAngle: mean(sides.map((side) => side.trunkAngle)),
    heelContact: footStates.length ? footStates.every(Boolean) : null,
    confidence: mean(sides.map((side) => side.confidence)),
    sideUsed: sides.length === 2 ? 'both' : sides[0].side,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function phaseDuration(frames: SquatFrameMetrics[], phases: MotionState[]) {
  const phaseFrames = frames.filter((frame) => phases.includes(frame.phase));
  return phaseFrames.length >= 2 ? phaseFrames[phaseFrames.length - 1].timestamp - phaseFrames[0].timestamp : null;
}

function depthLabel(minKneeAngle: number, frameCount: number): DepthLabel {
  if (frameCount < SQUAT_CONFIG.minFramesForCriterion) return 'não avaliável';
  if (minKneeAngle > SQUAT_CONFIG.depthThreshold) return 'acima da paralela';
  if (minKneeAngle > SQUAT_CONFIG.parallelAngle) return 'aproximadamente paralelo';
  return 'abaixo da paralela';
}

function checklistItem(key: string, label: string, status: ChecklistStatus, detail: string, feedback?: string): ChecklistItem {
  return { key, label, status, detail, feedback };
}

function statusDetail(status: ChecklistStatus, ok: string, attention: string, unavailable: string) {
  return status === 'OK' ? ok : status === 'ATENÇÃO' ? attention : unavailable;
}

function buildRepMetric(id: number, frames: SquatFrameMetrics[], baselineTrunkAngle: number | null): RepMetric {
  const minKneeAngle = Math.min(...frames.map((frame) => frame.kneeAngle));
  const durationMs = frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0;
  const depthPercent = Math.round(clamp(((170 - minKneeAngle) / 80) * 100, 0, 100));
  const label = depthLabel(minKneeAngle, frames.length);
  const trunkReference = baselineTrunkAngle ?? frames[0]?.trunkAngle ?? 0;
  const maxTrunkChange = Math.max(...frames.map((frame) => Math.abs(frame.trunkAngle - trunkReference)));
  const ascent = frames.filter((frame) => frame.phase === 'SUBINDO' || frame.phase === 'FINALIZAÇÃO');
  const enoughFrames = frames.length >= SQUAT_CONFIG.minFramesForCriterion;
  const descentDuration = phaseDuration(frames, ['DESCENDO']);
  const ascentDuration = phaseDuration(frames, ['SUBINDO', 'FINALIZAÇÃO']);
  const heelFrames = frames.map((frame) => frame.heelContact).filter((value): value is boolean => value !== null);
  const heelStatus: ChecklistStatus = heelFrames.length < SQUAT_CONFIG.minFramesForCriterion ? 'NÃO AVALIÁVEL' : heelFrames.every(Boolean) ? 'OK' : 'ATENÇÃO';
  const depthStatus: ChecklistStatus = label === 'não avaliável' ? 'NÃO AVALIÁVEL' : label === 'acima da paralela' ? 'ATENÇÃO' : 'OK';
  const controlStatus: ChecklistStatus = descentDuration === null ? 'NÃO AVALIÁVEL' : descentDuration >= 260 ? 'OK' : 'ATENÇÃO';
  const trunkStatus: ChecklistStatus = !enoughFrames ? 'NÃO AVALIÁVEL' : maxTrunkChange > SQUAT_CONFIG.trunkAngleThreshold ? 'ATENÇÃO' : 'OK';
  const hipStarts = ascent.findIndex((frame, index) => index > 0 && frame.hipY < ascent[Math.max(0, index - 1)].hipY - SQUAT_CONFIG.hipAscentDifferenceThreshold);
  const shoulderStarts = ascent.findIndex((frame, index) => index > 0 && frame.shoulderY < ascent[Math.max(0, index - 1)].shoulderY - SQUAT_CONFIG.hipAscentDifferenceThreshold);
  const syncStatus: ChecklistStatus = !ascent.length || hipStarts < 0 || shoulderStarts < 0 ? 'NÃO AVALIÁVEL' : hipStarts - shoulderStarts > 2 ? 'ATENÇÃO' : 'OK';
  const finalFrame = frames[frames.length - 1];
  const finishStatus: ChecklistStatus = !finalFrame || frames.length < SQUAT_CONFIG.minFramesForCriterion ? 'NÃO AVALIÁVEL' : finalFrame.trunkAngle - trunkReference > SQUAT_CONFIG.trunkAngleThreshold ? 'ATENÇÃO' : 'OK';
  const pelvicChange = enoughFrames && frames.length >= 12 && Math.abs(frames[Math.floor(frames.length * 0.55)].trunkAngle - frames[Math.floor(frames.length * 0.42)].trunkAngle) > SQUAT_CONFIG.trunkAngleThreshold;
  const issues: string[] = [];
  const feedback: string[] = [];
  const positives: string[] = [];
  if (heelStatus === 'ATENÇÃO') {
    issues.push('Perda de contato do calcanhar');
    feedback.push('Procure manter o apoio do pé estável durante o movimento. Se necessário, reduza a amplitude ou ajuste sua base.');
  }
  if (depthStatus === 'ATENÇÃO') {
    issues.push('Amplitude abaixo da meta');
    feedback.push('Na próxima série, tente manter uma amplitude consistente e controlada, respeitando a meta configurada.');
  }
  if (trunkStatus === 'ATENÇÃO') {
    issues.push('Alteração significativa da inclinação do tronco');
    feedback.push('Foi observada uma mudança significativa na inclinação do tronco. Tente manter maior controle da posição do tronco.');
  }
  if (syncStatus === 'ATENÇÃO') {
    issues.push('Possível perda de sincronia na subida');
    feedback.push('Na subida, o quadril parece iniciar antes do tronco. Tente subir mantendo os dois mais coordenados.');
  }
  if (finishStatus === 'ATENÇÃO') {
    issues.push('Movimento exagerado do tronco na finalização');
    feedback.push('Evite projetar excessivamente o tronco para trás ao finalizar.');
  }
  if (pelvicChange) {
    issues.push('Possível alteração da posição pélvica no fundo do movimento');
    feedback.push('A posição pélvica não foi estável em todos os frames do fundo. Reduza a amplitude se não conseguir manter controle.');
  }
  if (heelStatus === 'OK') positives.push('Apoio dos pés permaneceu estável.');
  if (depthStatus === 'OK') positives.push('Amplitude atingiu a meta configurada.');
  if (trunkStatus === 'OK') positives.push('Inclinação do tronco permaneceu estável.');
  if (syncStatus === 'OK') positives.push('Quadril e tronco subiram de maneira coordenada.');
  if (controlStatus === 'OK') positives.push('Descida realizada com controle.');
  const depthScore = label === 'não avaliável' ? null : clamp(100 - Math.abs(minKneeAngle - SQUAT_CONFIG.parallelAngle) * 2, 0, 100);
  const controlScore = descentDuration === null ? null : clamp(100 - Math.abs(700 - descentDuration) / 8, 0, 100);
  const trunkScore = !enoughFrames ? null : clamp(100 - maxTrunkChange * 3, 0, 100);
  const coordinationScore = syncStatus === 'NÃO AVALIÁVEL' ? null : syncStatus === 'ATENÇÃO' ? 60 : 100;
  const scoreValues = [depthScore, controlScore, trunkScore, coordinationScore].filter((value): value is number => value !== null);
  const executionIndex = scoreValues.length >= 2 ? Math.round(mean(scoreValues)) : 0;
  const note = issues[0] ?? (positives[0] ?? 'Movimento acompanhado sem alerta conclusivo');
  return {
    id,
    minKneeAngle: Math.round(minKneeAngle),
    depthPercent,
    depthLabel: label,
    executionIndex,
    durationMs,
    note,
    scoreBreakdown: {
      depth: depthScore === null ? null : Math.round(depthScore),
      control: controlScore === null ? null : Math.round(controlScore),
      trunk: trunkScore === null ? null : Math.round(trunkScore),
      coordination: coordinationScore,
    },
    checklist: [
      checklistItem('support', 'Apoio do pé', heelStatus, statusDetail(heelStatus, 'Calcanhar e ponta do pé permaneceram estáveis.', 'Foi observado afastamento do calcanhar do solo.', 'Calcanhar e ponta do pé não ficaram visíveis o suficiente.'), feedback.find((message) => message.includes('apoio'))),
      checklistItem('descent', 'Controle da descida', controlStatus, statusDetail(controlStatus, 'A descida teve duração suficiente para ser considerada controlada.', 'A descida foi muito rápida para uma leitura segura.', 'Não houve frames suficientes para estimar o controle.'), controlStatus === 'ATENÇÃO' ? 'Faça a descida de maneira mais controlada.' : undefined),
      checklistItem('depth', 'Amplitude', depthStatus, statusDetail(depthStatus, `Resultado: ${label}.`, 'Amplitude abaixo da meta configurada.', 'Não foi possível estimar a profundidade com confiança.'), feedback.find((message) => message.includes('amplitude'))),
      checklistItem('trunk', 'Estabilidade do tronco', trunkStatus, statusDetail(trunkStatus, 'A inclinação variou pouco em relação ao seu próprio setup.', 'Alteração significativa na inclinação durante a descida.', 'Não houve visibilidade suficiente do ombro e quadril.'), feedback.find((message) => message.includes('tronco'))),
      checklistItem('rise', 'Controle da subida', syncStatus, statusDetail(syncStatus, 'Quadril e tronco iniciaram a subida de maneira coordenada.', 'Foi observado que o quadril iniciou a subida antes do tronco.', 'Não foi possível comparar o início da subida.'), feedback.find((message) => message.includes('quadril'))),
      checklistItem('finish', 'Finalização', finishStatus, statusDetail(finishStatus, 'Retorno ao topo sem projeção excessiva do tronco.', 'Movimento exagerado do tronco ao finalizar.', 'Topo não ficou visível o suficiente.'), feedback.find((message) => message.includes('projetar'))),
    ],
    phaseAnalysis: [
      { phase: 'SETUP', status: baselineTrunkAngle === null ? 'NÃO AVALIÁVEL' : 'OK', durationMs: null, detail: baselineTrunkAngle === null ? 'Não foi possível formar um baseline confiável.' : 'Baseline do tronco registrado.' },
      { phase: 'DESCIDA', status: descentDuration === null ? 'NÃO AVALIÁVEL' : controlStatus, durationMs: descentDuration, detail: descentDuration === null ? 'Trajetória descendente insuficiente para avaliação.' : 'Quadril e joelhos acompanhados ao longo da descida.' },
      { phase: 'PROFUNDIDADE', status: depthStatus, durationMs: enoughFrames ? frames[Math.floor(frames.length * 0.2)]?.timestamp ?? null : null, detail: label === 'não avaliável' ? 'Ponto de maior flexão não pôde ser avaliado.' : `Profundidade ${label}.` },
      { phase: 'SUBIDA', status: ascentDuration === null ? 'NÃO AVALIÁVEL' : syncStatus, durationMs: ascentDuration, detail: syncStatus === 'ATENÇÃO' ? 'Quadril iniciou antes do tronco.' : syncStatus === 'OK' ? 'Subida coordenada.' : 'Não houve dados suficientes para comparar.' },
      { phase: 'FINALIZAÇÃO', status: finishStatus, durationMs: null, detail: finishStatus === 'ATENÇÃO' ? 'Alteração observada ao retornar ao topo.' : finishStatus === 'OK' ? 'Retorno controlado à posição inicial.' : 'Topo não ficou visível o suficiente.' },
    ],
    issues,
    positives,
    feedback,
    trajectory: frames.map((frame) => ({ x: frame.hipX, y: frame.hipY })),
  };
}

export function makeRepMetric(id: number, minKneeAngle: number, durationMs: number, frames: SquatFrameMetrics[] = [], baselineTrunkAngle: number | null = null): RepMetric {
  if (frames.length >= 2) return buildRepMetric(id, frames, baselineTrunkAngle);
  const depthPercent = Math.round(clamp(((170 - minKneeAngle) / 80) * 100, 0, 100));
  const depthLabel: DepthLabel = minKneeAngle > SQUAT_CONFIG.depthThreshold ? 'acima da paralela' : minKneeAngle > SQUAT_CONFIG.parallelAngle ? 'aproximadamente paralelo' : 'abaixo da paralela';
  const control = Math.round(clamp(100 - Math.abs(780 - durationMs) / 10, 0, 100));
  return {
    id,
    minKneeAngle: Math.round(minKneeAngle),
    depthPercent,
    depthLabel,
    executionIndex: Math.round(depthPercent * 0.52 + control * 0.48),
    durationMs,
    note: depthPercent >= 62 ? 'Profundidade consistente' : 'Busque um pouco mais de profundidade',
    scoreBreakdown: { depth: depthPercent, control, trunk: null, coordination: null },
    checklist: [],
    phaseAnalysis: [],
    issues: [],
    positives: [],
    feedback: [],
    trajectory: [],
  };
}

export function averageExecutionIndex(repetitions: RepMetric[]) {
  if (!repetitions.length) return null;
  return Math.round(mean(repetitions.map((rep) => rep.executionIndex)));
}

export function summarizeRepetitions(repetitions: RepMetric[]) {
  const issues = new Map<string, number>();
  const positives = new Map<string, number>();
  repetitions.forEach((rep) => {
    rep.issues.forEach((issue) => issues.set(issue, (issues.get(issue) ?? 0) + 1));
    rep.positives.forEach((positive) => positives.set(positive, (positives.get(positive) ?? 0) + 1));
  });
  const priorityMessages: Record<string, string> = {
    'Amplitude abaixo da meta': 'Mantenha a amplitude configurada de forma consistente e controlada.',
    'Possível perda de sincronia na subida': 'Suba mantendo quadril e tronco mais coordenados.',
    'Perda de contato do calcanhar': 'Mantenha o apoio do pé estável durante a execução.',
    'Alteração significativa da inclinação do tronco': 'Controle melhor a inclinação do tronco durante a descida.',
    'Movimento exagerado do tronco na finalização': 'Finalize sem projetar excessivamente o tronco para trás.',
    'Possível alteração da posição pélvica no fundo do movimento': 'Reduza a amplitude se não conseguir manter controle no fundo.',
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

export function saveReport(report: FitaiReport) {
  const history = loadHistory();
  localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  localStorage.setItem(HISTORY_KEY, JSON.stringify([report, ...history.filter((item) => item.id !== report.id)].slice(0, 20)));
}

export function loadReport(): FitaiReport | null {
  try {
    const value = localStorage.getItem(REPORT_KEY);
    return value ? (JSON.parse(value) as FitaiReport) : null;
  } catch {
    return null;
  }
}

export function loadHistory(): FitaiReport[] {
  try {
    const value = localStorage.getItem(HISTORY_KEY);
    return value ? (JSON.parse(value) as FitaiReport[]) : [];
  } catch {
    return [];
  }
}