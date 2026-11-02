import type { ChecklistStatus, RepMetric } from './fitai-analysis.ts';

export const VALIDATION_ALGORITHM_VERSION = 'fitai-squat-v2';
export const VALIDATION_HISTORY_LIMIT = 200;
export const VALIDATION_DATASET_TARGET = 50;

export const VALIDATION_CRITERIA = [
  { key: 'depth', label: 'Profundidade' },
  { key: 'trunk', label: 'Posicionamento do tronco' },
  { key: 'foot', label: 'Estabilidade aparente dos pés' },
  { key: 'descent', label: 'Controle da descida' },
  { key: 'ascent', label: 'Controle da subida' },
  { key: 'completion', label: 'Conclusão da repetição' },
] as const;

export type ValidationCriterion = (typeof VALIDATION_CRITERIA)[number]['key'];
export type HumanAssessmentValue = 'adequado' | 'inadequado' | 'não avaliável';
export type ValidationPartition = 'ajuste' | 'avaliação-final';
export type ValidationCategory =
  | 'adequado'
  | 'profundidade-insuficiente'
  | 'alteração-observável-do-tronco'
  | 'oclusão-ou-enquadramento-inadequado'
  | 'movimento-interrompido';

export type HumanAssessment = Record<ValidationCriterion, HumanAssessmentValue | ''>;
export type ValidationPredictions = Record<ValidationCriterion, HumanAssessmentValue | null>;

export type ValidationTestRecord = {
  id: string;
  fileName: string;
  category: ValidationCategory;
  partition: ValidationPartition;
  createdAt: string;
  assessment: HumanAssessment;
  observations: string;
  predictions: ValidationPredictions;
  repetitions: number;
  samples: number;
  trackedSamples: number;
  meanConfidence: number | null;
  delegate: 'GPU' | 'CPU';
  algorithmVersion: string;
};

export type ConfusionMatrix = { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
export type ValidationMetric = {
  criterion: ValidationCriterion;
  label: string;
  observations: number;
  matches: number;
  accuracy: number | null;
  sensitivity: number | null;
  specificity: number | null;
  precision: number | null;
  f1: number | null;
  confusion: ConfusionMatrix;
};

const STORAGE_KEY = 'fitai:validation-history';

export function emptyHumanAssessment(): HumanAssessment {
  return Object.fromEntries(VALIDATION_CRITERIA.map(({ key }) => [key, ''])) as HumanAssessment;
}

function scopedKey(userId?: string) {
  return userId ? `${STORAGE_KEY}:${encodeURIComponent(userId)}` : STORAGE_KEY;
}

export function predictValidationLabels(repetitions: RepMetric[]): ValidationPredictions {
  const checklistKeys: Partial<Record<ValidationCriterion, string>> = {
    depth: 'depth',
    trunk: 'trunk',
    foot: 'support',
    descent: 'descent',
    ascent: 'rise',
  };
  const predictions = Object.fromEntries(
    VALIDATION_CRITERIA.map(({ key }) => [key, null]),
  ) as ValidationPredictions;

  for (const { key } of VALIDATION_CRITERIA) {
    if (key === 'completion') {
      predictions[key] = repetitions.length
        ? 'adequado'
        : 'inadequado';
      continue;
    }
    const checklistKey = checklistKeys[key];
    if (!checklistKey) continue;
    const statuses = repetitions
      .map((rep) => rep.checklist?.find((item) => item.key === checklistKey)?.status)
      .filter((status): status is ChecklistStatus => status === 'OK' || status === 'ATENÇÃO');
    if (!statuses.length) continue;
    const adequateCount = statuses.filter((status) => status === 'OK').length;
    if (adequateCount === statuses.length / 2) continue;
    predictions[key] = adequateCount > statuses.length / 2 ? 'adequado' : 'inadequado';
  }
  return predictions;
}

export function calculateValidationMetrics(
  tests: ValidationTestRecord[],
  partition?: ValidationPartition,
): ValidationMetric[] {
  const selected = partition ? tests.filter((test) => test.partition === partition) : tests;
  return VALIDATION_CRITERIA.map(({ key, label }) => {
    const confusion: ConfusionMatrix = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
    let matches = 0;
    for (const test of selected) {
      const human = test.assessment[key];
      const fitai = test.predictions[key];
      if (
        (human !== 'adequado' && human !== 'inadequado') ||
        (fitai !== 'adequado' && fitai !== 'inadequado')
      ) continue;
      if (human === fitai) matches += 1;
      if (human === 'inadequado' && fitai === 'inadequado') confusion.truePositive += 1;
      else if (human === 'adequado' && fitai === 'inadequado') confusion.falsePositive += 1;
      else if (human === 'adequado' && fitai === 'adequado') confusion.trueNegative += 1;
      else if (human === 'inadequado' && fitai === 'adequado') confusion.falseNegative += 1;
    }
    const observations = matches + confusion.falsePositive + confusion.falseNegative;
    const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
    const sensitivity = ratio(confusion.truePositive, confusion.truePositive + confusion.falseNegative);
    const precision = ratio(confusion.truePositive, confusion.truePositive + confusion.falsePositive);
    return {
      criterion: key,
      label,
      observations,
      matches,
      accuracy: observations >= 5 ? matches / observations : null,
      sensitivity: observations >= 5 ? sensitivity : null,
      specificity: observations >= 5
        ? ratio(confusion.trueNegative, confusion.trueNegative + confusion.falsePositive)
        : null,
      precision: observations >= 5 ? precision : null,
      f1: observations >= 5 && precision !== null && sensitivity !== null && precision + sensitivity > 0
        ? (2 * precision * sensitivity) / (precision + sensitivity)
        : null,
      confusion,
    };
  });
}

export function loadValidationHistory(userId?: string): ValidationTestRecord[] {
  try {
    const value = localStorage.getItem(scopedKey(userId));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ValidationTestRecord =>
      Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.fileName === 'string'),
    );
  } catch {
    return [];
  }
}

export function saveValidationTest(record: ValidationTestRecord, userId?: string) {
  const history = loadValidationHistory(userId);
  const next = [record, ...history.filter((item) => item.id !== record.id)].slice(0, VALIDATION_HISTORY_LIMIT);
  localStorage.setItem(scopedKey(userId), JSON.stringify(next));
  return next;
}

export function deleteValidationTest(id: string, userId?: string) {
  const next = loadValidationHistory(userId).filter((item) => item.id !== id);
  localStorage.setItem(scopedKey(userId), JSON.stringify(next));
  return next;
}

export function clearValidationHistory(userId?: string) {
  localStorage.removeItem(scopedKey(userId));
}

export function createValidationTestRecord(input: Omit<ValidationTestRecord, 'id' | 'createdAt' | 'algorithmVersion'>): ValidationTestRecord {
  return {
    ...input,
    id: `validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    algorithmVersion: VALIDATION_ALGORITHM_VERSION,
  };
}
