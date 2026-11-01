import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, CircleAlert, Info, LoaderCircle, RotateCcw, ShieldCheck, Square, UserRound, UsersRound } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { Link } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { createPoseLandmarker } from '@/lib/pose-model';
import {
  SQUAT_CONFIG,
  SquatRepTracker,
  averageExecutionIndex,
  buildPhaseSummary,
  compareReports,
  LANDMARK_CONNECTIONS,
  landmarkIsVisible,
  loadHistory,
  saveReport,
  summarizeRepetitions,
  type FitaiReport,
  type MotionState,
  type Point,
  type RepMetric,
  type SquatFrameMetrics,
  type TrackingStatus,
} from '@/lib/fitai-analysis';

type Phase = 'setup' | 'preview' | 'loading' | 'running' | 'stopped';

type ZoomRange = { min: number; max: number; step: number };

function isUltraWideLabel(label = '') {
  return /ultra[\s-]?(wide|angular|grande)|0[,.]5\s*[x×]/i.test(label);
}

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
  const { userId } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new SquatRepTracker());
  const delegateRef = useRef<'GPU' | 'CPU'>('GPU');
  const cpuFallbackInProgressRef = useRef(false);
  const switchingCameraRef = useRef(false);
  const stopCameraRef = useRef<() => void>(() => {});
  const animationRef = useRef<number | null>(null);
  const hipTrajectoryRef = useRef<Array<{ x: number; y: number }>>([]);
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
  const [appliedZoom, setAppliedZoom] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [zoomDraft, setZoomDraft] = useState(1);
  const [zoomMode, setZoomMode] = useState<'standard' | 'hardware' | 'ultra-wide'>('standard');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const debugEnabled = new URLSearchParams(window.location.search).get('debug') === '1';

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput');
      setAvailableCameras(devices);
      return devices;
    } catch {
      return [];
    }
  }, []);

  const updateCameraSettings = useCallback((track: MediaStreamTrack, label = '') => {
    let zoom: { min: number; max: number; step?: number } | undefined;
    try {
      if (typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number };
        };
        zoom = capabilities.zoom;
      }
    } catch {
      zoom = undefined;
    }
    setZoomRange(zoom && zoom.max > zoom.min
      ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 }
      : null);

    let reportedZoom: number | null = null;
    try {
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
      if (typeof settings.zoom === 'number' && Number.isFinite(settings.zoom)) {
        reportedZoom = settings.zoom;
      }
    } catch {
      reportedZoom = null;
    }
    if (isUltraWideLabel(label)) {
      setZoomMode('ultra-wide');
      setCameraZoom(0.5);
      setAppliedZoom(0.5);
      setZoomDraft(1);
    } else {
      setZoomMode(reportedZoom === null ? 'standard' : 'hardware');
      setAppliedZoom(reportedZoom);
      setCameraZoom(reportedZoom !== null && reportedZoom < 0.75 ? 0.5 : 1);
      setZoomDraft(reportedZoom ?? 1);
    }
  }, []);

  useEffect(() => {
    void refreshCameraDevices();
  }, [refreshCameraDevices]);

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

  const switchCamera = useCallback(async (deviceId: string) => {
    if (!deviceId || deviceId === selectedCameraId || switchingCameraRef.current) return;
    const currentStream = streamRef.current;
    const currentTrack = currentStream?.getVideoTracks()[0];
    const previousDeviceId =
      currentTrack?.getSettings().deviceId || selectedCameraId || undefined;
    const video = videoRef.current;
    switchingCameraRef.current = true;
    setIsSwitchingCamera(true);
    let nextStream: MediaStream | null = null;

    const openDevice = (id?: string) => navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' as const } }),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });

    try {
      try {
        nextStream = await openDevice(deviceId);
      } catch {
        currentStream?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (video) {
          video.pause();
          video.srcObject = null;
        }
        nextStream = await openDevice(deviceId);
      }
      if (!video || !nextStream) throw new Error('camera-switch-unavailable');
      video.srcObject = nextStream;
      await video.play();
      streamRef.current = nextStream;
      if (currentStream !== nextStream) {
        currentStream?.getTracks().forEach((track) => track.stop());
      }

      trackerRef.current.resetMotion();
      setRepetitions(trackerRef.current.getRepetitions());
      hipTrajectoryRef.current = [];
      setDebugFrame(null);
      setTrackingStatus('incomplete');
      setMotionState('SETUP');
      const devices = await refreshCameraDevices();
      const activeTrack = nextStream.getVideoTracks()[0];
      const activeId = activeTrack.getSettings().deviceId || deviceId;
      setSelectedCameraId(activeId);
      updateCameraSettings(
        activeTrack,
        devices.find((device) => device.deviceId === activeId)?.label ?? '',
      );
      setError('');
    } catch {
      nextStream?.getTracks().forEach((track) => track.stop());
      try {
        let restoredStream = currentStream;
        if (!restoredStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
          restoredStream = await openDevice(previousDeviceId);
        }
        if (!video || !restoredStream) throw new Error('camera-switch-unavailable');
        video.srcObject = restoredStream;
        await video.play();
        streamRef.current = restoredStream;
        const restoredTrack = restoredStream.getVideoTracks()[0];
        const devices = await refreshCameraDevices();
        const restoredId = restoredTrack.getSettings().deviceId || previousDeviceId || '';
        setSelectedCameraId(restoredId);
        updateCameraSettings(
          restoredTrack,
          devices.find((device) => device.deviceId === restoredId)?.label ?? '',
        );
      } catch {
        streamRef.current = null;
        stopCameraRef.current();
      }
      setError('camera-switch-unavailable');
    } finally {
      switchingCameraRef.current = false;
      setIsSwitchingCamera(false);
    }
  }, [refreshCameraDevices, selectedCameraId, updateCameraSettings]);

  const applyCameraZoom = useCallback(async (zoom: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      if (typeof track.getCapabilities !== 'function') {
        setError('zoom-unavailable');
        return;
      }
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        zoom?: { min: number; max: number; step?: number };
      };
      if (!capabilities.zoom || zoom < capabilities.zoom.min || zoom > capabilities.zoom.max) {
        setError('zoom-unavailable');
        return;
      }
      await track.applyConstraints({ advanced: [{ zoom } as unknown as MediaTrackConstraintSet] });
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
      if (typeof settings.zoom !== 'number' || Math.abs(settings.zoom - zoom) > Math.max(0.05, (capabilities.zoom.step ?? 0) / 2)) {
        setError('zoom-unconfirmed');
        return;
      }
      setAppliedZoom(settings.zoom);
      setCameraZoom(settings.zoom < 0.75 ? 0.5 : 1);
      setZoomDraft(settings.zoom);
      setZoomMode('hardware');
      setError('');
    } catch {
      setError('zoom-unavailable');
    }
  }, []);

  const chooseHalfZoom = useCallback(async () => {
    const selectedCamera = availableCameras.find((device) => device.deviceId === selectedCameraId);
    const ultraWideCamera = availableCameras.find((device) => isUltraWideLabel(device.label));
    if (selectedCamera && isUltraWideLabel(selectedCamera.label)) {
      setCameraZoom(0.5);
      setAppliedZoom(0.5);
      setZoomMode('ultra-wide');
      setError('');
      return;
    }
    if (zoomRange && zoomRange.min <= 0.5 && zoomRange.max >= 0.5) {
      await applyCameraZoom(0.5);
      return;
    }
    if (ultraWideCamera) {
      await switchCamera(ultraWideCamera.deviceId);
      return;
    }
    setError('zoom-unavailable');
  }, [applyCameraZoom, availableCameras, selectedCameraId, switchCamera, zoomRange]);

  const chooseStandardZoom = useCallback(async () => {
    const selectedCamera = availableCameras.find((device) => device.deviceId === selectedCameraId);
    const standardCamera = availableCameras.find(
      (device) => device.deviceId !== selectedCameraId && !isUltraWideLabel(device.label),
    );
    if (selectedCamera && isUltraWideLabel(selectedCamera.label)) {
      if (standardCamera) {
        await switchCamera(standardCamera.deviceId);
      } else {
        setError('zoom-unavailable');
      }
      return;
    }
    if (zoomRange && zoomRange.min <= 1 && zoomRange.max >= 1) {
      await applyCameraZoom(1);
      return;
    }
    setCameraZoom(1);
    setAppliedZoom(null);
    setZoomMode('standard');
    setError('');
  }, [applyCameraZoom, availableCameras, selectedCameraId, switchCamera, zoomRange]);

  const fallbackToCpu = useCallback(async () => {
    if (delegateRef.current === 'CPU' || cpuFallbackInProgressRef.current) return;
    cpuFallbackInProgressRef.current = true;
    setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'CPU…' }));
    const previousLandmarker = landmarkerRef.current;
    landmarkerRef.current = null;
    try {
      previousLandmarker?.close();
      const cpuLandmarker = await createPoseLandmarker('CPU', SQUAT_CONFIG.confidenceThreshold);
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
    const update = trackerRef.current.processPose(poses, timestamp);
    setDetectorDiagnostics((previous) => ({
      ...previous,
      poseCount: poses.length,
      landmarkCount: update.landmarkCount,
    }));
    setTrackingStatus(update.displayStatus);
    setMotionState(update.motionState);
    if (update.frame) {
      hipTrajectoryRef.current = [...hipTrajectoryRef.current.slice(-90), { x: update.frame.hipX, y: update.frame.hipY }];
      setDebugFrame(update.frame);
    } else if (update.trackingStatus !== 'tracking') {
      hipTrajectoryRef.current = [];
      setDebugFrame(null);
    }
    drawOverlay(update.pose, update.displayStatus);
    if (update.completedRep) setRepetitions(update.repetitions);
  }, [drawOverlay]);

  const analysisLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || phase !== 'running') return;
    const now = performance.now();
    if (!switchingCameraRef.current && landmarker && video.readyState >= 2 && now - lastFrameRef.current > 45) {
      lastFrameRef.current = now;
      try {
        const result = landmarker.detectForVideo(video, now);
        processPose((result.landmarks ?? []) as Point[][], now);
      } catch (cause) {
        console.error('Falha durante o reconhecimento de pose.', cause);
        setTrackingStatus('bodyNotDetected');
        drawOverlay(null, 'bodyNotDetected');
        trackerRef.current.resetMotion();
        hipTrajectoryRef.current = [];
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
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    cpuFallbackInProgressRef.current = false;
    const reps = trackerRef.current.getRepetitions();
    if (reps.length) {
      const previous = loadHistory(userId ?? undefined)[0] ?? null;
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
      if (userId) saveReport(report, userId);
      else setError('auth-required');
      setLastReport(report);
    }
    setPhase('stopped');
  }, [userId]);
  stopCameraRef.current = stopCamera;

  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
  }, [userId]);

  const openCameraPreview = useCallback(async () => {
    setError('');
    setPhase('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
      const videoConstraints = {
        ...(selectedCameraId
          ? { deviceId: { exact: selectedCameraId } }
          : { facingMode: { ideal: 'environment' as const } }),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('camera-unavailable');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const devices = await refreshCameraDevices();
      const track = stream.getVideoTracks()[0];
      const activeId = track.getSettings().deviceId || selectedCameraId;
      setSelectedCameraId(activeId);
      updateCameraSettings(
        track,
        devices.find((device) => device.deviceId === activeId)?.label ?? '',
      );
      setPhase('preview');
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setPhase('setup');
      setError(cause instanceof DOMException
        ? cause.name === 'NotAllowedError' ? 'camera-blocked' : 'camera-unavailable'
        : 'camera-unavailable');
    }
  }, [refreshCameraDevices, selectedCameraId, updateCameraSettings]);

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setPhase('setup');
  }, []);

  const startAnalysis = useCallback(async () => {
    setError('');
    setPhase('loading');
    try {
      if (!streamRef.current || !videoRef.current) throw new Error('camera-unavailable');
      await videoRef.current.play();
      try {
        landmarkerRef.current = await createPoseLandmarker('GPU', SQUAT_CONFIG.confidenceThreshold);
        delegateRef.current = 'GPU';
        setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'GPU' }));
      } catch (gpuError) {
        console.warn('MediaPipe GPU delegate indisponível; tentando CPU.', gpuError);
        landmarkerRef.current = await createPoseLandmarker('CPU', SQUAT_CONFIG.confidenceThreshold);
        delegateRef.current = 'CPU';
        setDetectorDiagnostics((previous) => ({ ...previous, delegate: 'CPU' }));
      }
      cpuFallbackInProgressRef.current = false;
      trackerRef.current.reset();
      hipTrajectoryRef.current = [];
      setMotionState('SETUP');
      setTrackingStatus('incomplete');
      setDetectorDiagnostics({ poseCount: 0, landmarkCount: 0, delegate: delegateRef.current });
      setRepetitions([]);
      startedAtRef.current = Date.now();
      setPhase('running');
    } catch (cause) {
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      setPhase(streamRef.current ? 'preview' : 'setup');
      setError(cause instanceof DOMException
        ? cause.name === 'NotAllowedError' ? 'camera-blocked' : 'camera-unavailable'
        : 'model-unavailable');
    }
  }, []);

  const activeCamera = availableCameras.find((device) => device.deviceId === selectedCameraId);
  const ultraWideCamera = availableCameras.find((device) => isUltraWideLabel(device.label));
  const cameraSupportsHalfZoom = Boolean(
    (zoomRange && zoomRange.min <= 0.5 && zoomRange.max >= 0.5) ||
    isUltraWideLabel(activeCamera?.label) ||
    ultraWideCamera,
  );
  const zoomDescription = zoomMode === 'ultra-wide'
    ? 'Lente ultra-angular indicada pelo dispositivo'
    : appliedZoom !== null
      ? `Nível confirmado pela câmera: ${appliedZoom.toFixed(1)}×`
      : 'Câmera padrão; nível não informado pelo navegador';

  const phaseTitle = phase === 'setup'
    ? 'Prepare o enquadramento lateral.'
    : phase === 'preview'
      ? 'Confira o enquadramento antes de iniciar.'
      : phase === 'loading'
        ? 'Preparando a câmera e o reconhecimento.'
        : phase === 'running'
          ? 'Faça o seu movimento.'
          : 'Sessão finalizada.';
  const status = statusCopy[trackingStatus];

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div><div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> análise / squat lateral</div><h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Agachamento — Visão Lateral</h1>{import.meta.env.DEV && <Link href="/validation" data-testid="link-validation-tool" className="mt-3 inline-flex text-xs font-semibold text-[hsl(var(--muted-foreground))] underline underline-offset-4 hover:text-[hsl(var(--foreground))]">Validar vídeo gravado</Link>}</div>
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={15} className="text-[hsl(var(--accent))]" /> processamento local</div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.55fr)]">
          <section className="overflow-hidden rounded-[1.75rem] bg-[hsl(var(--secondary))] shadow-xl shadow-[hsl(222_29%_13%/.12)]">
            <div className="flex items-center justify-between px-5 py-4 text-[hsl(var(--secondary-foreground))] md:px-7">
              <div className="flex items-center gap-3"><span className={`h-2 w-2 rounded-full ${phase === 'running' ? 'bg-[hsl(var(--primary))] pulse-line' : phase === 'preview' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--secondary-foreground)/.3)]'}`} /><span className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.6)]">{phase === 'running' ? 'captura ativa' : phase === 'preview' ? 'prévia da câmera' : 'câmera em espera'}</span></div>
              <span data-testid="text-repetition-count" className="font-mono-fitai text-xs text-[hsl(var(--secondary-foreground)/.7)]">{String(repetitions.length).padStart(2, '0')} reps</span>
            </div>
             <div className="relative aspect-[4/3] min-h-[20rem] overflow-hidden bg-[#141923] md:aspect-video">
              <video ref={videoRef} data-testid="video-camera" className={`absolute inset-0 h-full w-full object-cover ${phase === 'running' || phase === 'preview' ? 'opacity-100' : 'opacity-0'}`} playsInline muted />
              <canvas ref={canvasRef} data-testid="canvas-pose-overlay" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              {(phase === 'running' || phase === 'preview') && <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-1.5">
                <div className="flex items-center gap-1 rounded-full border border-white/15 bg-[#141923]/75 p-1 text-[11px] text-white backdrop-blur">
                  <button type="button" onClick={() => void chooseHalfZoom()} disabled={!cameraSupportsHalfZoom || isSwitchingCamera} title={cameraSupportsHalfZoom ? 'Selecionar ultra-angular se o aparelho a expuser' : '0,5× não disponível nesta câmera'} data-testid="button-camera-zoom-05" className={`rounded-full px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cameraZoom === 0.5 ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-white/75 hover:bg-white/10'}`}>0,5×</button>
                  <button type="button" onClick={() => void chooseStandardZoom()} disabled={isSwitchingCamera} data-testid="button-camera-zoom-1" className={`rounded-full px-2.5 py-1.5 transition-colors ${cameraZoom === 1 ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-white/75 hover:bg-white/10'}`}>1×</button>
                </div>
                {zoomRange && zoomRange.max > Math.max(1, zoomRange.min) && <label className="flex items-center gap-2 rounded-full border border-white/15 bg-[#141923]/75 px-3 py-1.5 text-[10px] text-white backdrop-blur" data-testid="control-camera-zoom-range">
                  <span>{zoomDraft.toFixed(1)}×</span>
                  <input aria-label="Zoom da câmera" type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={Math.max(zoomRange.min, Math.min(zoomRange.max, zoomDraft))} onChange={(event) => setZoomDraft(Number(event.currentTarget.value))} onPointerUp={() => void applyCameraZoom(zoomDraft)} onKeyUp={() => void applyCameraZoom(zoomDraft)} className="w-24 accent-lime-300" />
                </label>}
                <span data-testid="text-camera-zoom-status" className="rounded-full bg-[#141923]/75 px-3 py-1 text-[10px] text-white/80 backdrop-blur">{zoomDescription}</span>
                {!cameraSupportsHalfZoom && <span className="rounded-lg bg-[#141923]/80 px-3 py-1.5 text-right text-[10px] text-white/75">0,5× indisponível nesta câmera</span>}
              </div>}
              {phase === 'preview' && <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/15 bg-[#141923]/75 px-4 py-3 text-center text-xs text-white backdrop-blur">Confira o corpo inteiro, da cabeça aos pés. A análise só começa quando você confirmar.</div>}
              {(phase === 'setup' || phase === 'loading' || phase === 'stopped') && <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-[hsl(var(--secondary-foreground))]"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[hsl(var(--secondary-foreground)/.18)] bg-[hsl(var(--secondary-foreground)/.06)]">{phase === 'loading' ? <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={25} /> : phase === 'stopped' ? <CheckCircle2 className="text-[hsl(var(--primary))]" size={27} /> : <Camera size={25} className="text-[hsl(var(--primary))]" />}</div><h2 className="text-xl font-semibold tracking-[-.03em]">{phaseTitle}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">{phase === 'stopped' ? `${repetitions.length} ${repetitions.length === 1 ? 'repetição válida' : 'repetições válidas'} registradas.` : 'Use um apoio estável, boa iluminação e mantenha cabeça, quadril, joelhos e pés dentro da imagem.'}</p></div>}
              {phase === 'running' && <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#141923] via-[#141923]/70 to-transparent px-5 pb-4 pt-12 text-[hsl(var(--secondary-foreground))] md:px-7"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--secondary-foreground)/.5)]">estado do movimento</p><p data-testid="text-motion-state" className="mt-1 text-lg font-semibold">{labelForState(motionState)}</p></div><div className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${trackingStatus === 'tracking' ? 'bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent))]'}`}>{status.title}</div></div>}
            </div>
            {phase === 'running' && <div data-testid="status-camera-tracking" className={`flex items-center gap-2 border-t border-[hsl(var(--secondary-foreground)/.12)] px-5 py-3 text-xs ${trackingStatus === 'tracking' ? 'text-[hsl(var(--secondary-foreground)/.62)]' : 'text-[hsl(var(--accent))]'}`}>{trackingStatus === 'multiple' ? <UsersRound size={15} /> : trackingStatus === 'incomplete' ? <CircleAlert size={15} /> : trackingStatus === 'bodyNotDetected' ? <UserRound size={15} /> : <CheckCircle2 size={15} />} {status.body}</div>}
             {debugEnabled && <div data-testid="debug-analysis-panel" className="grid grid-cols-2 gap-2 border-t border-[hsl(var(--secondary-foreground)/.12)] px-5 py-4 font-mono-fitai text-[10px] text-[hsl(var(--secondary-foreground)/.7)] md:grid-cols-4"><span>delegate {detectorDiagnostics.delegate}</span><span>poses {detectorDiagnostics.poseCount}</span><span>landmarks {detectorDiagnostics.landmarkCount}</span><span>{debugFrame ? `ângulo ${Math.round(debugFrame.kneeAngle)}° · confiança ${Math.round(debugFrame.confidence * 100)}%` : 'esperando landmarks'}</span></div>}
          </section>
          <aside className="flex flex-col gap-4">
            <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-5 md:p-6">
              <p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">posicionamento lateral</p>
              {availableCameras.length > 1 && <label htmlFor="camera-device-select" className="mt-4 block text-xs font-medium text-[hsl(var(--foreground))]">
                Câmera do aparelho
                <select id="camera-device-select" data-testid="select-camera-device" value={selectedCameraId} disabled={isSwitchingCamera} onChange={(event) => {
                  const deviceId = event.currentTarget.value;
                  if (phase === 'preview' || phase === 'running') void switchCamera(deviceId);
                  else setSelectedCameraId(deviceId);
                }} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  <option value="">Automática (traseira)</option>
                  {availableCameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Câmera ${index + 1}`}{isUltraWideLabel(device.label) ? ' · ultra-angular' : ''}</option>)}
                </select>
                {isSwitchingCamera && <span className="mt-1 block text-[10px] text-[hsl(var(--muted-foreground))]">Trocando a câmera; as repetições já concluídas serão mantidas.</span>}
              </label>}
              <div className="mt-5 space-y-4">
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">01</span><p className="text-sm leading-5">Apoie o celular e posicione-o aproximadamente <strong className="font-semibold">perpendicular ao seu corpo</strong>.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">02</span><p className="text-sm leading-5">Antes de iniciar, confira cabeça, quadril, joelhos, tornozelos, calcanhares e pontas dos pés.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">03</span><p className="text-sm leading-5">Evite contraluz, pouca iluminação e obstáculos; mantenha apenas uma pessoa visível.</p></div>
              </div>
            </div>
            <div className="rounded-[1.5rem] bg-[hsl(var(--muted)/.72)] p-5">
              <div className="flex gap-3"><Info size={17} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">A análise mostra uma trajetória aproximada em 2D. Ela não estima centro de massa, linha de gravidade real ou causa de possíveis desvios.</p></div>
            </div>
              {error && <div data-testid="status-camera-error" className="rounded-[1.25rem] border border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm leading-5 text-[hsl(var(--destructive))]">{error === 'camera-blocked' ? 'A câmera está bloqueada. Permita o acesso nas configurações do navegador e tente novamente.' : error === 'zoom-unavailable' ? 'Este dispositivo não oferece zoom 0,5× pela câmera atual. Selecione uma lente ultra-angular quando ela for identificada pelo navegador.' : error === 'zoom-unconfirmed' ? 'O navegador não confirmou o nível de zoom aplicado; a interface não vai apresentá-lo como 0,5×.' : error === 'camera-switch-unavailable' ? 'Não foi possível trocar a câmera neste navegador. As repetições concluídas foram mantidas.' : error === 'model-unavailable' ? 'O modelo de reconhecimento não conseguiu iniciar neste navegador. Recarregue a página e tente novamente.' : 'Não foi possível acessar a câmera neste dispositivo ou navegador.'}</div>}
            <div className="mt-auto flex flex-wrap gap-3">
              {phase === 'setup' && <button type="button" onClick={() => void openCameraPreview()} data-testid="button-start-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-transform hover:-translate-y-0.5"><Camera size={17} className="text-[hsl(var(--primary))]" /> Ativar câmera e enquadrar</button>}
              {phase === 'loading' && <button type="button" disabled data-testid="button-loading-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary)/.65)] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground)/.6)]"><LoaderCircle size={17} className="animate-spin" /> Preparando captura</button>}
              {phase === 'preview' && <><button type="button" onClick={() => void startAnalysis()} data-testid="button-confirm-start-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]"><Camera size={17} className="text-[hsl(var(--primary))]" /> Iniciar análise</button><button type="button" onClick={stopPreview} data-testid="button-cancel-camera-preview" className="rounded-full border border-[hsl(var(--border))] px-4 py-3.5 text-sm font-semibold">Cancelar</button></>}
              {phase === 'running' && <button type="button" onClick={stopCamera} data-testid="button-stop-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--accent))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5"><Square size={15} fill="currentColor" /> Encerrar sessão</button>}
              {phase === 'stopped' && <><button type="button" onClick={() => { trackerRef.current.reset(); setRepetitions([]); setError(''); setPhase('setup'); setLastReport(null); }} data-testid="button-new-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-3.5 text-sm font-semibold transition-colors hover:bg-[hsl(var(--muted))]"><RotateCcw size={16} /> Nova análise</button>{lastReport && <Link href="/report" data-testid="button-view-report" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]">Ver relatório <CheckCircle2 size={16} className="text-[hsl(var(--primary))]" /></Link>}</>}
            </div>
          </aside>
        </div>
        <div className="mt-8 flex items-start gap-3 border-t border-[hsl(var(--border))] pt-5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><CameraOff size={15} className="mt-0.5 shrink-0" /><p>O vídeo e os pontos do corpo são processados localmente no navegador. Nenhuma imagem é enviada ou salva pelo FITAI.</p></div>
      </div>
    </AppShell>
  );
}