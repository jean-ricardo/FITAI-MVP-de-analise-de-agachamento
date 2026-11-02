export type PoseDelegateName = 'GPU' | 'CPU';

export async function createPoseWithCpuFallback<T>(
  create: (delegate: PoseDelegateName) => Promise<T>,
) {
  try {
    return { poseLandmarker: await create('GPU'), delegate: 'GPU' as const };
  } catch (gpuInitializationError) {
    const poseLandmarker = await create('CPU');
    return { poseLandmarker, delegate: 'CPU' as const, gpuInitializationError };
  }
}
