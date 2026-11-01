import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export const POSE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export type PoseDelegate = 'GPU' | 'CPU';

export async function createPoseLandmarker(
  delegate: PoseDelegate,
  confidenceThreshold: number,
) {
  const vision = await FilesetResolver.forVisionTasks(POSE_WASM_URL);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 2,
    minPoseDetectionConfidence: confidenceThreshold,
    minPosePresenceConfidence: confidenceThreshold,
    minTrackingConfidence: confidenceThreshold,
  });
}
