export type ZoomRange = { min: number; max: number; step?: number };
export type CameraFacing = 'frontal' | 'traseira' | 'não identificada';

export function normalizeCameraFacing(mode?: string): CameraFacing {
  if (mode === 'user') return 'frontal';
  if (mode === 'environment') return 'traseira';
  return 'não identificada';
}

export function supportsZoomLevel(range: ZoomRange | undefined, requested: number) {
  return Boolean(
    range &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    requested >= range.min &&
    requested <= range.max,
  );
}

export function isZoomLevelConfirmed(
  reportedZoom: number | undefined,
  requested: number,
  step = 0,
) {
  if (reportedZoom === undefined || !Number.isFinite(reportedZoom)) return false;
  return Math.abs(reportedZoom - requested) <= Math.max(0.05, step / 2);
}

export function labelSuggestsUltraWide(label = '') {
  return /ultra[\s-]?(wide|angular|grande)|0[,.]5\s*[x×]/i.test(label);
}
