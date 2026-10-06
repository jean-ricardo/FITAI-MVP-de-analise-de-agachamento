import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, CircleAlert, Info, LoaderCircle, RotateCcw, ShieldCheck, Square, UserRound, UsersRound } from 'lucide-react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import {
  SQUAT_CONFIG,
  averageExecutionIndex,
  buildPhaseSummary,
  compareReports,
  getSquatMetrics,
  getTrackingStatus,
  isFullBodyVisible,
  LANDMARK_CONNECTIONS,
  landmarkIsVisible,
  loadHistory,
  makeRepMetric,
  saveReport,
  smoothLandmarks,
  summarizeRepetitions,
  type FitaiReport,
  type MotionState,
  type Point,
  type RepMetric,
  type SquatFrameMetrics,
  type TrackingStatus,
} from '@/lib/fitai-analysis';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
type Phase = 'setup' | 'loading' | 'running' | 'stopped';

const statusCopy: Record<TrackingStatus, { title: string; body: string }> = {
  tracking: { title: 'Corpo enquadrado', body: 'Perfil visível. Continue no seu ritmo.' },
  bodyNotDetected: { title: 'Procurando seu corpo', body: 'Fique aproximadamente perpendicular à câmera e entre no enquadramento.' },
  multiple: { title: 'Uma pessoa por vez', body: 'Mais de uma pessoa apareceu. A análise precisa de um único corpo.' },
  incomplete: { title: 'Ajuste a câmera', body: 'Não é possível realizar uma análise lateral confiável. Ajuste a câmera.' },
};

function labelForState(state: MotionState) {
  return state === 'SETUP' ? 'EM PÉ' : state.replace('_', ' ');
}

export default function Analyze() {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const delegateRef = useRef<'GPU' | 'CPU'>('GPU');
  const cpuFallbackInProgressRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const previousLandmarksRef = useRef<Point[] | null>(null);
  const motionRef = useRef<MotionState>('SETUP');
  const repsRef = useRef<RepMetric[]>([]);
  const currentRepFramesRef = useRef<SquatFrameMetrics[]>([]);
  const hipTrajectoryRef = useRef<Array<{ x: number; y: number }>>([]);
  const trunkTrajectoryRef = useRef<Array<{ x: number; y: number }>>([]);
  const baselineTrunkRef = useRef<number | null>(null);
  const stateAtRef = useRef(0);
  const minAngleRef = useRef(180);
  const startedAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState('');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('incomplete');
  const [motionState, setMotionState] = useState<MotionState>('SETUP');
  const [repetitions, setRepetitions] = useState<RepMetric[]>([]);
  const [lastReport, setLastReport] = useState<FitaiReport | null>(null);
  const [debugFrame, setDebugFrame] = useState<SquatFrameMetrics | null>(null);
  const [detectorDiagnostics, setDetectorDiagnostics] = useState({ poseCount: 0, landmarkCount: 0, delegate: 'iniciando' });
  const [cameraZoom, setCameraZoom] = useState<0.5 | 1>(1);
  const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';

  const drawOverlay = useCallback((pose: Point[] | null, status: TrackingStatus) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!pose || status === 'bodyNotDetected' || status === 'multiple') return;
    context.lineCap = 'round';
    context.lineWidth = Math.max(2, width / 240);
    context.strokeStyle = 'rgba(205, 255, 62, .82)';
    LANDMARK_CONNECTIONS.forEach(([from, to]) => {
      const a = pose?.[from];
      const b = pose?.[to];
      if (!landmarkIsVisible(a) || !landmarkIsVisible(b)) return;
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
    });
    if (hipTrajectoryRef.current.length > 1) {
      context.strokeStyle = 'rgba(255, 130, 106, .92)';
      context.lineWidth = Math.max(2, width / 280);
      context.beginPath();
      hipTrajectoryRef.current.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x * width, point.y * height);
        else context.lineTo(point.x * width, point.y * height);
      });
      context.stroke();
    }
    pose?.forEach((point, index) => {
      if (index < 11 || !point || !landmarkIsVisible(point)) return;
      context.fillStyle = index === 25 || index === 26 ? '#ff826a' : '#cdff3e';
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(3, width / 100), 0, Math.PI * 2);
      context.fill();
    });
  }, []);

  const applyCameraZoom = useCallback(async (zoom: 0.5 | 1) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min: number; max: number; step?: number };
    };
    if (!capabilities.zoom || zoom < capabilities.zoom.min || zoom > capabilities.zoom.max) {
      setError('zoom-unavailable');
      return;
    }
    try {
      await track.applyConstraints({ advanced: [{ zoom } as unknown as MediaTrackConstraintSet] });
      setCameraZoom(zoom);
      setError('');
    } catch {
      setError('zoom-unavailable');
    }
  }, []);

  const addRep = useCallback((frames: SquatFrameMetrics[]) => {
    const metric = makeRepMetric(repsRef.current.length + 1, minAngleRef.current, frames[frames.length - 1].timestamp - frames[0].timestamp, frames, baselineTrunkRef.current);
    const updated = [...repsRef.current, metric];
    repsRef.current = updated;
    setRepetitions(updated);
  }, []);

  const fallbackToCpu = useCallback(async () => {
    if (delegateRef.current === 'CPU' || cpuFallbackInProgressRef.current) return;
    cpuFallbackInProgressRef.current = true;
    setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'CPU…' }));
    const previousLandmarker = landmarkerRef.current;
    landmarkerRef.current = null;
    previousLandmarker?.close();
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const cpuLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: SQUAT_CONFIG.confidenceThreshold,
        minPosePresenceConfidence: SQUAT_CONFIG.confidenceThreshold,
        minTrackingConfidence: SQUAT_CONFIG.confidenceThreshold,
      });
      if (!streamRef.current) {
        cpuLandmarker.close();
        return;
      }
      landmarkerRef.current = cpuLandmarker;
      delegateRef.current = 'CPU';
      setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'CPU' }));
      setError('');
    } catch (cause) {
      console.error('MediaPipe não conseguiu iniciar o processamento CPU.', cause);
      setError('model-unavailable');
    } finally {
      cpuFallbackInProgressRef.current = false;
    }
  }, []);

  const processPose = useCallback((poses: Point[][], timestamp: number) => {
    const visibleLandmarks = poses.length === 1
      ? poses[0].filter((point) => point && landmarkIsVisible(point)).length
      : 0;
    setDetectorDiagnostics((previous) => ({
      ...previous,
      poseCount: poses.length,
      landmarkCount: visibleLandmarks,
    }));
    const baseStatus = getTrackingStatus(poses);
    const status = baseStatus === 'tracking' && !isFullBodyVisible(poses[0]) ? 'incomplete' : baseStatus;
    setTrackingStatus(status);
    // O corpo inteiro é uma orientação de enquadramento, não um bloqueio do
    // detector. Em celulares, a câmera pode cortar um pouco da imagem mesmo
    // quando os landmarks principais estão confiáveis.
    if (baseStatus !== 'tracking') {
      previousLandmarksRef.current = null;
      currentRepFramesRef.current = [];
      motionRef.current = 'SETUP';
      minAngleRef.current = 180;
      setMotionState('SETUP');
      drawOverlay(poses.length === 1 ? poses[0] : null, baseStatus);
      return;
    }
    const smoothed = smoothLandmarks(previousLandmarksRef.current, poses[0]);
    previousLandmarksRef.current = smoothed;
    const frame = getSquatMetrics(smoothed);
    if (!frame) {
      drawOverlay(null, 'incomplete');
      return;
    }
    frame.timestamp = timestamp;
    frame.phase = motionRef.current;
    hipTrajectoryRef.current = [...hipTrajectoryRef.current.slice(-90), { x: frame.hipX, y: frame.hipY }];
    trunkTrajectoryRef.current = [...trunkTrajectoryRef.current.slice(-90), { x: frame.shoulderX, y: frame.shoulderY }];
    drawOverlay(smoothed, status);
    setDebugFrame(frame);
    if (motionRef.current === 'SETUP') {
      baselineTrunkRef.current = baselineTrunkRef.current === null ? frame.trunkAngle : baselineTrunkRef.current * 0.9 + frame.trunkAngle * 0.1;
    }
    const angle = frame.kneeAngle;
    const motion = motionRef.current;
    if (motion === 'SETUP' && angle > 153) {
      setMotionState('EM_PÉ');
      motionRef.current = 'EM_PÉ';
    } else if (motion === 'EM_PÉ' && angle < 150) {
      frame.phase = 'DESCENDO';
      currentRepFramesRef.current = [frame];
      motionRef.current = 'DESCENDO';
      stateAtRef.current = timestamp;
      minAngleRef.current = angle;
      setMotionState('DESCENDO');
    } else if (motion === 'DESCENDO') {
      frame.phase = 'DESCENDO';
      currentRepFramesRef.current.push(frame);
      minAngleRef.current = Math.min(minAngleRef.current, angle);
      if (angle <= SQUAT_CONFIG.depthThreshold) {
        motionRef.current = 'EMBAIXO';
        setMotionState('EMBAIXO');
      }
    } else if (motion === 'EMBAIXO') {
      frame.phase = 'EMBAIXO';
      currentRepFramesRef.current.push(frame);
      minAngleRef.current = Math.min(minAngleRef.current, angle);
      if (angle > 120) {
        motionRef.current = 'SUBINDO';
        setMotionState('SUBINDO');
      }
    } else if (motion === 'SUBINDO') {
      frame.phase = 'SUBINDO';
      currentRepFramesRef.current.push(frame);
      if (angle > 153) {
        frame.phase = 'FINALIZAÇÃO';
        currentRepFramesRef.current.push(frame);
        addRep(currentRepFramesRef.current);
        currentRepFramesRef.current = [];
        motionRef.current = 'EM_PÉ';
        setMotionState('EM_PÉ');
        minAngleRef.current = 180;
      }
    } else if (motion === 'EM_PÉ' && angle < 150) {
      frame.phase = 'DESCENDO';
      currentRepFramesRef.current = [frame];
      motionRef.current = 'DESCENDO';
      stateAtRef.current = timestamp;
      minAngleRef.current = angle;
      setMotionState('DESCENDO');
    }
  }, [addRep, drawOverlay]);

  const analysisLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || phase !== 'running') return;
    const now = performance.now();
    if (landmarker && video.readyState >= 2 && now - lastFrameRef.current > 45) {
      lastFrameRef.current = now;
      try {
        const result = landmarker.detectForVideo(video, now);
        processPose((result.landmarks ?? []) as Point[][], now);
      } catch (cause) {
        console.error('Falha durante o reconhecimento de pose.', cause);
        setTrackingStatus('bodyNotDetected');
        drawOverlay(null, 'bodyNotDetected');
        if (delegateRef.current === 'GPU') void fallbackToCpu();
        else setError('model-unavailable');
      }
    }
    animationRef.current = requestAnimationFrame(analysisLoop);
  }, [drawOverlay, fallbackToCpu, phase, processPose]);

  useEffect(() => {
    if (phase === 'running') animationRef.current = requestAnimationFrame(analysisLoop);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analysisLoop, phase]);

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    cpuFallbackInProgressRef.current = false;
    const reps = repsRef.current;
    if (reps.length) {
      const previous = loadHistory()[0] ?? null;
      const summary = summarizeRepetitions(reps);
      const baseReport: FitaiReport = {
        id: `session-${Date.now()}`,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - (startedAtRef.current || Date.now()),
        repetitions: reps,
        executionIndex: averageExecutionIndex(reps),
        reliability: 'reliable',
        phaseAnalysis: buildPhaseSummary(reps),
        priorities: summary.priorities,
        positives: summary.positives,
        limitations: ['A análise depende da posição da câmera, iluminação e visibilidade do corpo.', 'A trajetória é uma aproximação em 2D; não mede centro de massa nem linha de gravidade real.', 'Critérios sem landmarks suficientes são marcados como não avaliáveis.'],
        trend: 'insufficient',
        previousComparison: null,
      };
      const previousComparison = compareReports(baseReport, previous);
      const report: FitaiReport = {
        ...baseReport,
        previousComparison,
        trend: previousComparison ? previousComparison.indexDelta > 2 ? 'improving' : previousComparison.indexDelta < -2 ? 'declining' : 'stable' : 'insufficient',
      };
      saveReport(report);
      setLastReport(report);
    }
    setPhase('stopped');
  }, []);

  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
  }, []);

  const startAnalysis = useCallback(async () => {
    setError('');
    setPhase('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('camera-unavailable');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const options = {
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: SQUAT_CONFIG.confidenceThreshold,
        minPosePresenceConfidence: SQUAT_CONFIG.confidenceThreshold,
        minTrackingConfidence: SQUAT_CONFIG.confidenceThreshold,
      } as const;
      try {
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        });
        delegateRef.current = 'GPU';
        setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'GPU' }));
      } catch (gpuError) {
        console.warn('MediaPipe GPU delegate indisponível; tentando CPU.', gpuError);
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        });
        delegateRef.current = 'CPU';
        setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'CPU' }));
      }
      cpuFallbackInProgressRef.current = false;
      repsRef.current = [];
      currentRepFramesRef.current = [];
      previousLandmarksRef.current = null;
      hipTrajectoryRef.current = [];
      trunkTrajectoryRef.current = [];
      baselineTrunkRef.current = null;
      setCameraZoom(1);
      motionRef.current = 'SETUP';
      setMotionState('SETUP');
      setTrackingStatus('incomplete');
      setDetectorDiagnostics({ poseCount: 0, landmarkCount: 0, delegate: 'iniciando' });
      setRepetitions([]);
      startedAtRef.current = Date.now();
      setPhase('running');
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setPhase('setup');
      setError(cause instanceof DOMException
        ? cause.name === 'NotAllowedError' ? 'camera-blocked' : 'camera-unavailable'
        : 'model-unavailable');
    }
  }, []);

  const phaseTitle = phase === 'setup' ? 'Prepare o enquadramento lateral.' : phase === 'loading' ? 'Preparando seu olhar.' : phase === 'running' ? 'Faça o seu movimento.' : 'Sessão finalizada.';
  const status = statusCopy[trackingStatus];

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div><div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> análise / squat lateral</div><h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Agachamento — Visão Lateral</h1></div>
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={15} className="text-[hsl(var(--accent))]" /> processamento local</div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.55fr)]">
          <section className="overflow-hidden rounded-[1.75rem] bg-[hsl(var(--secondary))] shadow-xl shadow-[hsl(222_29%_13%/.12)]">
            <div className="flex items-center justify-between px-5 py-4 text-[hsl(var(--secondary-foreground))] md:px-7">
              <div className="flex items-center gap-3"><span className={`h-2 w-2 rounded-full ${phase === 'running' ? 'bg-[hsl(var(--primary))] pulse-line' : 'bg-[hsl(var(--secondary-foreground)/.3)]'}`} /><span className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.6)]">{phase === 'running' ? 'captura ativa' : 'câmera em espera'}</span></div>
              <span data-testid="text-repetition-count" className="font-mono-fitai text-xs text-[hsl(var(--secondary-foreground)/.7)]">{String(repetitions.length).padStart(2, '0')} reps</span>
            </div>
             <div className="relative aspect-[4/3] min-h-[20rem] overflow-hidden bg-[#141923] md:aspect-video">
              <video ref={videoRef} data-testid="video-camera" className={`absolute inset-0 h-full w-full object-cover ${phase === 'running' ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
              <canvas ref={canvasRef} data-testid="canvas-pose-overlay" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
               {phase === 'running' && <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full border border-white/15 bg-[#141923]/75 p-1 text-[11px] text-white backdrop-blur"><button type="button" onClick={() => applyCameraZoom(0.5)} data-testid="button-camera-zoom-05" className={`rounded-full px-2.5 py-1.5 transition-colors ${cameraZoom === 0.5 ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-white/75 hover:bg-white/10'}`}>0,5×</button><button type="button" onClick={() => applyCameraZoom(1)} data-testid="button-camera-zoom-1" className={`rounded-full px-2.5 py-1.5 transition-colors ${cameraZoom === 1 ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-white/75 hover:bg-white/10'}`}>1×</button></div>}
              {phase !== 'running' && <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-[hsl(var(--secondary-foreground))]"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[hsl(var(--secondary-foreground)/.18)] bg-[hsl(var(--secondary-foreground)/.06)]">{phase === 'loading' ? <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={25} /> : phase === 'stopped' ? <CheckCircle2 className="text-[hsl(var(--primary))]" size={27} /> : <Camera size={25} className="text-[hsl(var(--primary))]" />}</div><h2 className="text-xl font-semibold tracking-[-.03em]">{phaseTitle}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">{phase === 'stopped' ? `${repetitions.length} ${repetitions.length === 1 ? 'repetição válida' : 'repetições válidas'} registradas.` : 'O FITAI precisa ver seu corpo inteiro, dos pés à cabeça.'}</p></div>}
              {phase === 'running' && <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#141923] via-[#141923]/70 to-transparent px-5 pb-4 pt-12 text-[hsl(var(--secondary-foreground))] md:px-7"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--secondary-foreground)/.5)]">estado do movimento</p><p data-testid="text-motion-state" className="mt-1 text-lg font-semibold">{labelForState(motionState)}</p></div><div className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${trackingStatus === 'tracking' ? 'bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent))]'}`}>{status.title}</div></div>}
            </div>
            {phase === 'running' && <div data-testid="status-camera-tracking" className={`flex items-center gap-2 border-t border-[hsl(var(--secondary-foreground)/.12)] px-5 py-3 text-xs ${trackingStatus === 'tracking' ? 'text-[hsl(var(--secondary-foreground)/.62)]' : 'text-[hsl(var(--accent))]'}`}>{trackingStatus === 'multiple' ? <UsersRound size={15} /> : trackingStatus === 'incomplete' ? <CircleAlert size={15} /> : trackingStatus === 'bodyNotDetected' ? <UserRound size={15} /> : <CheckCircle2 size={15} />} {status.body}</div>}
             {debugEnabled && <div data-testid="debug-analysis-panel" className="grid grid-cols-2 gap-2 border-t border-[hsl(var(--secondary-foreground)/.12)] px-5 py-4 font-mono-fitai text-[10px] text-[hsl(var(--secondary-foreground)/.7)] md:grid-cols-4"><span>delegate {detectorDiagnostics.delegate}</span><span>poses {detectorDiagnostics.poseCount}</span><span>landmarks {detectorDiagnostics.landmarkCount}</span><span>{debugFrame ? `ângulo ${Math.round(debugFrame.kneeAngle)}° · confiança ${Math.round(debugFrame.confidence * 100)}%` : 'esperando landmarks'}</span></div>}
          </section>
          <aside className="flex flex-col gap-4">
            <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-5 md:p-6">
              <p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">posicionamento lateral</p>
              <div className="mt-5 space-y-4">
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">01</span><p className="text-sm leading-5">Posicione a câmera aproximadamente <strong className="font-semibold">perpendicular ao seu corpo</strong>.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">02</span><p className="text-sm leading-5">Mantenha cabeça, tronco, quadril, joelho, tornozelo e pé visíveis.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">03</span><p className="text-sm leading-5">Use boa iluminação e mantenha apenas uma pessoa na área de análise.</p></div>
              </div>
            </div>
            <div className="rounded-[1.5rem] bg-[hsl(var(--muted)/.72)] p-5">
              <div className="flex gap-3"><Info size={17} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">A análise mostra uma trajetória aproximada em 2D. Ela não estima centro de massa, linha de gravidade real ou causa de possíveis desvios.</p></div>
            </div>
              {error && <div data-testid="status-camera-error" className="rounded-[1.25rem] border border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm leading-5 text-[hsl(var(--destructive))]">{error === 'camera-blocked' ? 'A câmera está bloqueada. Permita o acesso nas configurações do navegador e tente novamente.' : error === 'zoom-unavailable' ? 'Este dispositivo não oferece zoom 0,5× pela câmera atual. Afaste o aparelho ou use 1×.' : error === 'model-unavailable' ? 'O modelo de reconhecimento não conseguiu iniciar neste navegador. Recarregue a página e tente novamente.' : 'Não foi possível acessar a câmera neste dispositivo ou navegador.'}</div>}
            <div className="mt-auto flex flex-wrap gap-3">
              {phase === 'setup' && <button type="button" onClick={startAnalysis} data-testid="button-start-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-transform hover:-translate-y-0.5"><Camera size={17} className="text-[hsl(var(--primary))]" /> Ativar câmera</button>}
              {phase === 'loading' && <button type="button" disabled data-testid="button-loading-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary)/.65)] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground)/.6)]"><LoaderCircle size={17} className="animate-spin" /> Carregando análise</button>}
              {phase === 'running' && <button type="button" onClick={stopCamera} data-testid="button-stop-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--accent))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5"><Square size={15} fill="currentColor" /> Encerrar sessão</button>}
              {phase === 'stopped' && <><button type="button" onClick={() => { setError(''); setPhase('setup'); setLastReport(null); }} data-testid="button-new-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-3.5 text-sm font-semibold transition-colors hover:bg-[hsl(var(--muted))]"><RotateCcw size={16} /> Nova análise</button>{lastReport && <Link href="/report" data-testid="button-view-report" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]">Ver relatório <CheckCircle2 size={16} className="text-[hsl(var(--primary))]" /></Link>}</>}
            </div>
          </aside>
        </div>
        <div className="mt-8 flex items-start gap-3 border-t border-[hsl(var(--border))] pt-5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><CameraOff size={15} className="mt-0.5 shrink-0" /><p>O vídeo e os pontos do corpo são processados localmente no navegador. Nenhuma imagem é enviada ou salva pelo FITAI.</p></div>
      </div>
    </AppShell>
  );
}