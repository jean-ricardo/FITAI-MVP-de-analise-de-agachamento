import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileVideo2, LoaderCircle, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import { Link } from 'wouter';
import { AppShell } from '@/components/app-shell';
import {
  SQUAT_CONFIG,
  SquatRepTracker,
  type DepthLabel,
  type RepMetric,
  type TrackingStatus,
} from '@/lib/fitai-analysis';
import { createPoseLandmarker, type PoseDelegate } from '@/lib/pose-model';

type ValidationStatus = 'idle' | 'loading' | 'running' | 'done' | 'error';
type ReferenceHeel = '' | 'OK' | 'ATENÇÃO';
type ReferenceDepth = '' | Exclude<DepthLabel, 'não avaliável'>;

type ValidationResult = {
  repetitions: RepMetric[];
  samples: number;
  trackedSamples: number;
  meanConfidence: number | null;
  delegate: PoseDelegate;
};

const depthOptions: ReferenceDepth[] = [
  '',
  'acima da paralela',
  'aproximadamente paralelo',
  'abaixo da paralela',
];

function mostCommonDepth(repetitions: RepMetric[]): DepthLabel {
  const counts = new Map<DepthLabel, number>();
  repetitions.forEach((rep) => {
    if (rep.depthLabel !== 'não avaliável') {
      counts.set(rep.depthLabel, (counts.get(rep.depthLabel) ?? 0) + 1);
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'não avaliável';
}

function aggregateChecklistStatus(repetitions: RepMetric[], key: string) {
  const values = repetitions
    .map((rep) => rep.checklist.find((item) => item.key === key)?.status)
    .filter((value): value is 'OK' | 'ATENÇÃO' => value === 'OK' || value === 'ATENÇÃO');
  if (!values.length) return null;
  return values.filter((value) => value === 'OK').length >= values.length / 2 ? 'OK' : 'ATENÇÃO';
}

function Comparison({ label, predicted, reference }: { label: string; predicted: string; reference: string }) {
  const matches = predicted === reference;
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-4">
      <p className="text-xs font-semibold">{label}</p>
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">FITAI: {predicted}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Rótulo informado: {reference}</p>
      <p className={`mt-2 text-[10px] font-semibold ${matches ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'}`}>
        {matches ? 'Coincide com o rótulo' : 'Diverge do rótulo'}
      </p>
    </div>
  );
}

export default function Validation() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new SquatRepTracker());
  const delegateRef = useRef<PoseDelegate>('GPU');
  const frameRequestRef = useRef<number | null>(null);
  const statsRef = useRef({ samples: 0, trackedSamples: 0, confidenceTotal: 0, confidenceSamples: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [videoCategory, setVideoCategory] = useState('não classificado');
  const [referenceReps, setReferenceReps] = useState('');
  const [referenceDepth, setReferenceDepth] = useState<ReferenceDepth>('');
  const [referenceHeel, setReferenceHeel] = useState<ReferenceHeel>('');
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('incomplete');
  const [delegate, setDelegate] = useState<PoseDelegate>('GPU');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current);
    landmarkerRef.current?.close();
  }, []);

  const finishValidation = useCallback(() => {
    const repetitions = trackerRef.current.getRepetitions();
    const stats = statsRef.current;
    setResult({
      repetitions,
      samples: stats.samples,
      trackedSamples: stats.trackedSamples,
      meanConfidence: stats.confidenceSamples
        ? stats.confidenceTotal / stats.confidenceSamples
        : null,
      delegate: delegateRef.current,
    });
    setProgress(1);
    setStatus('done');
    setTrackingStatus('incomplete');
  }, []);

  const startValidation = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !objectUrl) return;
    setError('');
    setResult(null);
    setProgress(0);
    setStatus('loading');
    trackerRef.current.reset();
    statsRef.current = { samples: 0, trackedSamples: 0, confidenceTotal: 0, confidenceSamples: 0 };
    try {
      if (!landmarkerRef.current) {
        try {
          landmarkerRef.current = await createPoseLandmarker('GPU', SQUAT_CONFIG.confidenceThreshold);
          delegateRef.current = 'GPU';
        } catch {
          landmarkerRef.current = await createPoseLandmarker('CPU', SQUAT_CONFIG.confidenceThreshold);
          delegateRef.current = 'CPU';
        }
        setDelegate(delegateRef.current);
      }
      video.currentTime = 0;
      await video.play();
      setStatus('running');

      let lastVideoTime = -1;
      let lastTimestamp = performance.now();
      const sampleFrame = async () => {
        if (video.ended) {
          finishValidation();
          return;
        }
        if (video.paused || !landmarkerRef.current) return;
        if (video.readyState >= 2 && video.currentTime > lastVideoTime + 0.035) {
          lastVideoTime = video.currentTime;
          const timestamp = Math.max(performance.now(), lastTimestamp + 1);
          lastTimestamp = timestamp;
          try {
            const detection = landmarkerRef.current.detectForVideo(video, timestamp);
            const update = trackerRef.current.processPose(
              (detection.landmarks ?? []) as Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>,
              video.currentTime * 1000,
            );
            statsRef.current.samples += 1;
            if (update.trackingStatus === 'tracking') statsRef.current.trackedSamples += 1;
            if (update.frame) {
              statsRef.current.confidenceTotal += update.frame.confidence;
              statsRef.current.confidenceSamples += 1;
            }
            setTrackingStatus(update.displayStatus);
            setProgress(video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
          } catch (cause) {
            if (delegateRef.current !== 'GPU') throw cause;
            landmarkerRef.current.close();
            landmarkerRef.current = await createPoseLandmarker('CPU', SQUAT_CONFIG.confidenceThreshold);
            delegateRef.current = 'CPU';
            setDelegate('CPU');
            const fallbackTimestamp = Math.max(performance.now(), lastTimestamp + 1);
            lastTimestamp = fallbackTimestamp;
            const detection = landmarkerRef.current.detectForVideo(video, fallbackTimestamp);
            const update = trackerRef.current.processPose(
              (detection.landmarks ?? []) as Array<Array<{ x: number; y: number; z?: number; visibility?: number }>>,
              video.currentTime * 1000,
            );
            statsRef.current.samples += 1;
            if (update.trackingStatus === 'tracking') statsRef.current.trackedSamples += 1;
            if (update.frame) {
              statsRef.current.confidenceTotal += update.frame.confidence;
              statsRef.current.confidenceSamples += 1;
            }
            setTrackingStatus(update.displayStatus);
          }
        }
        frameRequestRef.current = requestAnimationFrame(() => {
          void sampleFrame().catch((cause) => {
            video.pause();
            setStatus('error');
            setError(cause instanceof Error ? cause.message : 'Falha ao processar um frame do vídeo.');
          });
        });
      };
      frameRequestRef.current = requestAnimationFrame(() => {
        void sampleFrame().catch((cause) => {
          video.pause();
          setStatus('error');
          setError(cause instanceof Error ? cause.message : 'Falha ao processar um frame do vídeo.');
        });
      });
    } catch (cause) {
      video.pause();
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'O modelo não conseguiu processar este vídeo.');
    }
  }, [finishValidation, objectUrl]);

  const resetValidation = useCallback(() => {
    if (frameRequestRef.current !== null) cancelAnimationFrame(frameRequestRef.current);
    frameRequestRef.current = null;
    videoRef.current?.pause();
    trackerRef.current.reset();
    setStatus('idle');
    setResult(null);
    setError('');
    setProgress(0);
    setTrackingStatus('incomplete');
  }, []);

  const detectedDepth = result ? mostCommonDepth(result.repetitions) : 'não avaliável';
  const detectedHeel = result ? aggregateChecklistStatus(result.repetitions, 'support') : null;
  const expectedReps = referenceReps === '' ? null : Number(referenceReps);

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Link href="/analyze" className="mb-4 inline-flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><ArrowLeft size={14} /> Voltar à câmera</Link>
            <div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> ferramenta interna / desenvolvimento</div>
            <h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Validar vídeo de agachamento</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={15} className="text-[hsl(var(--accent))]" /> vídeo fica neste navegador</div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)]">
          <section className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-5 md:p-7">
            <div className="flex items-center gap-3">
              <FileVideo2 className="text-[hsl(var(--accent))]" size={19} />
              <div><h2 className="text-sm font-semibold">Escolha um vídeo local</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">O arquivo não é enviado, armazenado ou incorporado ao FITAI.</p></div>
            </div>
            <label className="mt-5 block rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-sm">
              <span className="mb-2 block text-xs font-medium">Arquivo de vídeo</span>
              <input type="file" accept="video/*" data-testid="input-validation-video" disabled={status === 'running' || status === 'loading'} onChange={(event) => {
                resetValidation();
                setFile(event.currentTarget.files?.[0] ?? null);
              }} className="w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-[hsl(var(--secondary))] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[hsl(var(--secondary-foreground))]" />
            </label>
            {objectUrl && <video ref={videoRef} src={objectUrl} controls playsInline preload="metadata" data-testid="video-validation" className="mt-5 max-h-[36rem] w-full rounded-xl bg-black" />}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium">Classificação manual do vídeo
                <select value={videoCategory} onChange={(event) => setVideoCategory(event.currentTarget.value)} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  <option>não classificado</option><option>referência confiável</option><option>desvio conhecido</option><option>teste de rastreamento</option>
                </select>
              </label>
              <label className="text-xs font-medium">Repetições de referência (opcional)
                <input type="number" min="0" step="1" value={referenceReps} onChange={(event) => setReferenceReps(event.currentTarget.value)} placeholder="Informar apenas se conferido" className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium">Rótulo manual de profundidade (opcional)
                <select value={referenceDepth} onChange={(event) => setReferenceDepth(event.currentTarget.value as ReferenceDepth)} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  {depthOptions.map((option) => <option key={option} value={option}>{option || 'Não informado'}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium">Rótulo manual do apoio do pé (opcional)
                <select value={referenceHeel} onChange={(event) => setReferenceHeel(event.currentTarget.value as ReferenceHeel)} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  <option value="">Não informado</option><option value="OK">Calcanhar estável</option><option value="ATENÇÃO">Calcanhar levantou</option>
                </select>
              </label>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full bg-[hsl(var(--primary))] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void startValidation()} disabled={!objectUrl || status === 'loading' || status === 'running'} data-testid="button-run-validation" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--secondary-foreground))] disabled:opacity-45">
                {status === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={15} />}
                {status === 'running' ? 'Processando vídeo' : status === 'loading' ? 'Carregando modelo' : 'Processar vídeo'}
              </button>
              <button type="button" onClick={resetValidation} disabled={!file || status === 'loading'} className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-3 text-sm font-semibold disabled:opacity-45"><RotateCcw size={15} /> Limpar análise</button>
            </div>
            {status === 'running' && <p role="status" className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Analisando os frames do vídeo. Rastreamento atual: {trackingStatus}. Delegate: {delegate}.</p>}
            {error && <p role="alert" className="mt-4 rounded-xl bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}
          </section>

          <aside className="space-y-5">
            <section className="rounded-[1.5rem] bg-[hsl(var(--secondary))] p-5 text-[hsl(var(--secondary-foreground))] md:p-6">
              <p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">resultado do detector</p>
              {result ? <>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">repetições</span><strong className="mt-1 block text-2xl">{result.repetitions.length}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">frames rastreados</span><strong className="mt-1 block text-2xl">{result.trackedSamples}/{result.samples}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">confiança média</span><strong className="mt-1 block text-2xl">{result.meanConfidence === null ? '—' : `${Math.round(result.meanConfidence * 100)}%`}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">delegate final</span><strong className="mt-1 block text-2xl">{result.delegate}</strong></div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--primary))]"><CheckCircle2 size={14} /> Processamento concluído</div>
              </> : <p className="mt-5 text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">{status === 'running' ? 'O detector está processando o vídeo.' : 'Escolha um vídeo e inicie o processamento para ver os resultados.'}</p>}
              {result && <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-xs text-white/65">Profundidade mais frequente no resultado: <strong className="text-white">{detectedDepth}</strong></p>
                <p className="mt-2 text-xs text-white/65">Categoria registrada: <strong className="text-white">{videoCategory}</strong></p>
              </div>}
            </section>

            {result && (expectedReps !== null || referenceDepth || referenceHeel) && <section className="space-y-3">
              <h2 className="text-sm font-semibold">Comparação com rótulos informados</h2>
              {expectedReps !== null && <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-4">
                <p className="text-xs font-semibold">Contagem de repetições</p>
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">FITAI: {result.repetitions.length} · rótulo informado: {expectedReps} · diferença absoluta: {Math.abs(result.repetitions.length - expectedReps)}</p>
              </div>}
              {referenceDepth && detectedDepth !== 'não avaliável' && <Comparison label="Profundidade" predicted={detectedDepth} reference={referenceDepth} />}
              {referenceHeel && detectedHeel && <Comparison label="Apoio do pé" predicted={detectedHeel} reference={referenceHeel} />}
            </section>}

            <section className="rounded-[1.25rem] border border-[hsl(var(--border))] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--accent))]">limites deste teste</p>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Rótulos devem ser conferidos manualmente. O vídeo anexado não fornece ground truth por critério só por conter marcações visuais. Esta ferramenta não calcula precisão geral, diagnóstico clínico nem validação científica.</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
