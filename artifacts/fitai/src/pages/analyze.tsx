import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, CircleAlert, Info, LoaderCircle, RotateCcw, ShieldCheck, Square, UserRound, UsersRound } from 'lucide-react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import {
  averageExecutionIndex,
  getSquatMetrics,
  getTrackingStatus,
  LANDMARK_CONNECTIONS,
  makeRepMetric,
  saveReport,
  smoothLandmarks,
  type FitaiReport,
  type MotionState,
  type Point,
  type RepMetric,
  type TrackingStatus,
} from '@/lib/fitai-analysis';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

type Phase = 'setup' | 'loading' | 'running' | 'stopped';

const statusCopy: Record<TrackingStatus, { title: string; body: string }> = {
  tracking: { title: 'Corpo enquadrado', body: 'Movimento visível. Continue no seu ritmo.' },
  bodyNotDetected: { title: 'Procurando seu corpo', body: 'Fique de frente para a câmera e entre no enquadramento.' },
  multiple: { title: 'Uma pessoa por vez', body: 'Mais de uma pessoa apareceu. A análise precisa de um único corpo.' },
  incomplete: { title: 'Enquadramento incompleto', body: 'Não foi possível identificar corretamente seu corpo.' },
};

export default function Analyze() {
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const previousLandmarksRef = useRef<Point[] | null>(null);
  const motionRef = useRef<MotionState>('EM_PÉ');
  const trackingRef = useRef<TrackingStatus>('bodyNotDetected');
  const repsRef = useRef<RepMetric[]>([]);
  const stateAtRef = useRef(0);
  const minAngleRef = useRef(180);
  const startedAtRef = useRef(0);
  const lastFrameRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState('');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('bodyNotDetected');
  const [motionState, setMotionState] = useState<MotionState>('EM_PÉ');
  const [repetitions, setRepetitions] = useState<RepMetric[]>([]);
  const [lastReport, setLastReport] = useState<FitaiReport | null>(null);

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
    if (!pose || status !== 'tracking') return;
    context.lineCap = 'round';
    context.lineWidth = Math.max(2, width / 240);
    context.strokeStyle = 'rgba(205, 255, 62, .82)';
    LANDMARK_CONNECTIONS.forEach(([from, to]) => {
      const a = pose[from];
      const b = pose[to];
      if (!a || !b) return;
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
    });
    pose.forEach((point, index) => {
      if (index < 11 || !point || point.visibility !== undefined && point.visibility < .45) return;
      context.fillStyle = index === 25 || index === 26 ? '#ff826a' : '#cdff3e';
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(3, width / 100), 0, Math.PI * 2);
      context.fill();
    });
  }, []);

  const addRep = useCallback((durationMs: number) => {
    const metric = makeRepMetric(repsRef.current.length + 1, minAngleRef.current, durationMs);
    const updated = [...repsRef.current, metric];
    repsRef.current = updated;
    setRepetitions(updated);
  }, []);

  const processPose = useCallback((poses: Point[][]) => {
    const status = getTrackingStatus(poses);
    trackingRef.current = status;
    setTrackingStatus(status);
    if (status !== 'tracking') {
      previousLandmarksRef.current = null;
      motionRef.current = 'EM_PÉ';
      minAngleRef.current = 180;
      setMotionState('EM_PÉ');
      drawOverlay(null, status);
      return;
    }
    const smoothed = smoothLandmarks(previousLandmarksRef.current, poses[0]);
    previousLandmarksRef.current = smoothed;
    drawOverlay(smoothed, status);
    const metrics = getSquatMetrics(smoothed);
    if (!metrics) return;
    const angle = metrics.kneeAngle;
    const motion = motionRef.current;
    if (motion === 'EM_PÉ' && angle < 150) {
      motionRef.current = 'DESCENDO';
      stateAtRef.current = performance.now();
      minAngleRef.current = angle;
      setMotionState('DESCENDO');
    } else if (motion === 'DESCENDO') {
      minAngleRef.current = Math.min(minAngleRef.current, angle);
      if (angle <= 112) {
        motionRef.current = 'EMBAIXO';
        setMotionState('EMBAIXO');
      } else if (angle > 153) {
        motionRef.current = 'EM_PÉ';
        setMotionState('EM_PÉ');
      }
    } else if (motion === 'EMBAIXO') {
      minAngleRef.current = Math.min(minAngleRef.current, angle);
      if (angle > 120) {
        motionRef.current = 'SUBINDO';
        setMotionState('SUBINDO');
      }
    } else if (motion === 'SUBINDO') {
      minAngleRef.current = Math.min(minAngleRef.current, angle);
      if (angle > 153) {
        addRep(performance.now() - stateAtRef.current);
        motionRef.current = 'EM_PÉ';
        setMotionState('EM_PÉ');
        minAngleRef.current = 180;
      }
    }
  }, [addRep, drawOverlay]);

  const analysisLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || phase !== 'running') return;
    const now = performance.now();
    if (video.readyState >= 2 && now - lastFrameRef.current > 45) {
      lastFrameRef.current = now;
      const result = landmarker.detectForVideo(video, now);
      processPose((result.landmarks ?? []) as Point[][]);
    }
    animationRef.current = requestAnimationFrame(analysisLoop);
  }, [phase, processPose]);

  useEffect(() => {
    if (phase === 'running') {
      animationRef.current = requestAnimationFrame(analysisLoop);
    }
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analysisLoop, phase]);

  const stopCamera = useCallback((goToReport = false) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    const reps = repsRef.current;
    if (reps.length) {
      const report: FitaiReport = {
        id: `session-${Date.now()}`,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - (startedAtRef.current || Date.now()),
        repetitions: reps,
        executionIndex: averageExecutionIndex(reps),
        reliability: 'reliable',
      };
      saveReport(report);
      setLastReport(report);
    }
    setPhase('stopped');
    if (goToReport) setLocation('/report');
  }, [setLocation]);

  useEffect(() => () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      repsRef.current = [];
      previousLandmarksRef.current = null;
      motionRef.current = 'EM_PÉ';
      setMotionState('EM_PÉ');
      setRepetitions([]);
      startedAtRef.current = Date.now();
      setPhase('running');
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setPhase('setup');
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'camera-blocked' : 'camera-unavailable');
    }
  }, []);

  const phaseTitle = phase === 'setup' ? 'Prepare o enquadramento.' : phase === 'loading' ? 'Preparando seu olhar.' : phase === 'running' ? 'Faça o seu movimento.' : 'Sessão finalizada.';
  const status = statusCopy[trackingStatus];

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div><div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> análise / squat 01</div><h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Análise de Agachamento</h1></div>
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
              {phase !== 'running' && <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-[hsl(var(--secondary-foreground))]"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[hsl(var(--secondary-foreground)/.18)] bg-[hsl(var(--secondary-foreground)/.06)]">{phase === 'loading' ? <LoaderCircle className="animate-spin text-[hsl(var(--primary))]" size={25} /> : phase === 'stopped' ? <CheckCircle2 className="text-[hsl(var(--primary))]" size={27} /> : <Camera size={25} className="text-[hsl(var(--primary))]" />}</div><h2 className="text-xl font-semibold tracking-[-.03em]">{phaseTitle}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">{phase === 'stopped' ? `${repetitions.length} ${repetitions.length === 1 ? 'repetição válida' : 'repetições válidas'} registradas.` : 'O FITAI precisa ver seu corpo inteiro, dos pés à cabeça.'}</p></div>}
              {phase === 'running' && <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#141923] via-[#141923]/70 to-transparent px-5 pb-4 pt-12 text-[hsl(var(--secondary-foreground))] md:px-7"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--secondary-foreground)/.5)]">estado do movimento</p><p data-testid="text-motion-state" className="mt-1 text-lg font-semibold">{motionState.replace('_', ' ')}</p></div><div className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${trackingStatus === 'tracking' ? 'bg-[hsl(var(--primary)/.16)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--accent)/.16)] text-[hsl(var(--accent))]'}`}>{status.title}</div></div>}
            </div>
            {phase === 'running' && <div data-testid="status-camera-tracking" className={`flex items-center gap-2 border-t border-[hsl(var(--secondary-foreground)/.12)] px-5 py-3 text-xs ${trackingStatus === 'tracking' ? 'text-[hsl(var(--secondary-foreground)/.62)]' : 'text-[hsl(var(--accent))]'}`}>{trackingStatus === 'multiple' ? <UsersRound size={15} /> : trackingStatus === 'incomplete' ? <CircleAlert size={15} /> : trackingStatus === 'bodyNotDetected' ? <UserRound size={15} /> : <CheckCircle2 size={15} />} {status.body}</div>}
          </section>

          <aside className="flex flex-col gap-4">
            <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-5 md:p-6">
              <p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">antes de começar</p>
              <div className="mt-5 space-y-4">
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">01</span><p className="text-sm leading-5">Apoie o celular na vertical, a cerca de 2 metros, com a <strong className="font-semibold">câmera traseira</strong> apontada para você.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">02</span><p className="text-sm leading-5">Fique de lado para a câmera. Mantenha a cabeça e os pés dentro da imagem.</p></div>
                <div className="flex gap-3"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">03</span><p className="text-sm leading-5">Deixe espaço ao redor do corpo e garanta boa iluminação, sem contraluz.</p></div>
              </div>
            </div>
            <div className="rounded-[1.5rem] bg-[hsl(var(--muted)/.72)] p-5">
              <div className="flex gap-3"><Info size={17} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Uma pessoa por vez. Se o corpo sair do quadro, o FITAI pausa a leitura e não inventa uma repetição.</p></div>
            </div>
            {error && <div data-testid="status-camera-error" className="rounded-[1.25rem] border border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm leading-5 text-[hsl(var(--destructive))]">{error === 'camera-blocked' ? 'A câmera está bloqueada. Permita o acesso nas configurações do navegador e tente novamente.' : 'Não foi possível acessar a câmera neste dispositivo ou navegador.'}</div>}
            <div className="mt-auto flex flex-wrap gap-3">
              {phase === 'setup' && <button type="button" onClick={startAnalysis} data-testid="button-start-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-transform hover:-translate-y-0.5"><Camera size={17} className="text-[hsl(var(--primary))]" /> Ativar câmera</button>}
              {phase === 'loading' && <button type="button" disabled data-testid="button-loading-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary)/.65)] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground)/.6)]"><LoaderCircle size={17} className="animate-spin" /> Carregando análise</button>}
              {phase === 'running' && <button type="button" onClick={() => stopCamera(false)} data-testid="button-stop-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--accent))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--accent-foreground))] transition-transform hover:-translate-y-0.5"><Square size={15} fill="currentColor" /> Encerrar sessão</button>}
              {phase === 'stopped' && <><button type="button" onClick={() => { setError(''); setPhase('setup'); }} data-testid="button-new-analysis" className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[hsl(var(--border))] px-5 py-3.5 text-sm font-semibold transition-colors hover:bg-[hsl(var(--muted))]"><RotateCcw size={16} /> Nova análise</button>{lastReport && <Link href="/report" data-testid="button-view-report" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]">Ver relatório <CheckCircle2 size={16} className="text-[hsl(var(--primary))]" /></Link>}</>}
            </div>
          </aside>
        </div>
        <div className="mt-8 flex items-start gap-3 border-t border-[hsl(var(--border))] pt-5 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><CameraOff size={15} className="mt-0.5 shrink-0" /><p>O vídeo e os pontos do corpo são processados localmente no navegador. Nenhuma imagem é enviada ou salva pelo FITAI.</p></div>
      </div>
    </AppShell>
  );
}