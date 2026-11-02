import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { ArrowLeft, CheckCircle2, Database, FileVideo2, LoaderCircle, Play, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
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
import { createPoseWithCpuFallback } from '@/lib/pose-runtime';
import {
  calculateValidationMetrics,
  clearValidationHistory,
  createValidationTestRecord,
  deleteValidationTest,
  emptyHumanAssessment,
  loadValidationHistory,
  predictValidationLabels,
  saveValidationTest,
  VALIDATION_ALGORITHM_VERSION,
  VALIDATION_CRITERIA,
  VALIDATION_DATASET_TARGET,
  type HumanAssessment,
  type HumanAssessmentValue,
  type ValidationCategory,
  type ValidationPartition,
  type ValidationTestRecord,
} from '@/lib/validation-lab';

type ValidationStatus = 'idle' | 'loading' | 'running' | 'done' | 'error';
type AssessmentValue = HumanAssessmentValue | '';

type ValidationResult = {
  repetitions: RepMetric[];
  samples: number;
  trackedSamples: number;
  meanConfidence: number | null;
  delegate: PoseDelegate;
  predictions: ReturnType<typeof predictValidationLabels>;
};

const validationCategories: { value: ValidationCategory; label: string }[] = [
  { value: 'adequado', label: 'Movimento adequado' },
  { value: 'profundidade-insuficiente', label: 'Profundidade insuficiente' },
  { value: 'alteração-observável-do-tronco', label: 'Alteração observável do tronco' },
  { value: 'oclusão-ou-enquadramento-inadequado', label: 'Oclusão ou enquadramento inadequado' },
  { value: 'movimento-interrompido', label: 'Movimento interrompido' },
];

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function humanLabel(value: AssessmentValue) {
  return value || 'aguardando rótulo';
}

export default function Validation() {
  const { userId } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new SquatRepTracker());
  const delegateRef = useRef<PoseDelegate>('GPU');
  const frameRequestRef = useRef<number | null>(null);
  const statsRef = useRef({ samples: 0, trackedSamples: 0, confidenceTotal: 0, confidenceSamples: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [videoCategory, setVideoCategory] = useState<ValidationCategory | ''>('');
  const [partition, setPartition] = useState<ValidationPartition>('ajuste');
  const [assessment, setAssessment] = useState<HumanAssessment>(emptyHumanAssessment);
  const [assessmentNotes, setAssessmentNotes] = useState('');
  const [assessmentSaved, setAssessmentSaved] = useState(false);
  const [history, setHistory] = useState<ValidationTestRecord[]>(() => loadValidationHistory(userId ?? undefined));
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('incomplete');
  const [delegate, setDelegate] = useState<PoseDelegate>('GPU');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const assessmentComplete = VALIDATION_CRITERIA.every(({ key }) => assessment[key] !== '');

  useEffect(() => {
    setHistory(loadValidationHistory(userId ?? undefined));
  }, [userId]);

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
    const predictions = predictValidationLabels(repetitions);
    const validationResult: ValidationResult = {
      repetitions,
      samples: stats.samples,
      trackedSamples: stats.trackedSamples,
      meanConfidence: stats.confidenceSamples
        ? stats.confidenceTotal / stats.confidenceSamples
        : null,
      delegate: delegateRef.current,
      predictions,
    };
    setResult(validationResult);
    if (file && videoCategory && assessmentSaved && assessmentComplete) {
      const record = createValidationTestRecord({
        fileName: file.name,
        category: videoCategory,
        partition,
        assessment: assessment as Record<(typeof VALIDATION_CRITERIA)[number]['key'], HumanAssessmentValue>,
        observations: assessmentNotes,
        predictions,
        repetitions: repetitions.length,
        samples: stats.samples,
        trackedSamples: stats.trackedSamples,
        meanConfidence: validationResult.meanConfidence,
        delegate: delegateRef.current,
      });
      setHistory(saveValidationTest(record, userId ?? undefined));
    }
    setProgress(1);
    setStatus('done');
    setTrackingStatus('incomplete');
  }, [assessment, assessmentComplete, assessmentNotes, assessmentSaved, file, partition, userId, videoCategory]);

  const startValidation = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !objectUrl || !file || !assessmentComplete || !assessmentSaved || !videoCategory) {
      setError('Preencha e registre primeiro a avaliação humana, incluindo a classificação do vídeo.');
      return;
    }
    setError('');
    setResult(null);
    setProgress(0);
    setStatus('loading');
    trackerRef.current.reset();
    statsRef.current = { samples: 0, trackedSamples: 0, confidenceTotal: 0, confidenceSamples: 0 };
    try {
      if (!landmarkerRef.current) {
        const created = await createPoseWithCpuFallback((delegate) =>
          createPoseLandmarker(delegate, SQUAT_CONFIG.confidenceThreshold),
        );
        landmarkerRef.current = created.poseLandmarker;
        delegateRef.current = created.delegate;
        if (created.delegate === 'CPU') {
          console.warn('GPU indisponível no laboratório; usando delegate CPU.', created.gpuInitializationError);
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
            if (update.displayStatus === 'tracking') statsRef.current.trackedSamples += 1;
            if (update.frame) {
              statsRef.current.confidenceTotal += update.frame.confidence;
              statsRef.current.confidenceSamples += 1;
            }
            setTrackingStatus(update.displayStatus);
            setProgress(video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
          } catch (cause) {
            if (delegateRef.current !== 'GPU') throw cause;
            trackerRef.current.handleTrackingLoss();
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
            if (update.displayStatus === 'tracking') statsRef.current.trackedSamples += 1;
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
  }, [assessmentComplete, assessmentSaved, file, finishValidation, objectUrl, videoCategory]);

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

  const removeCurrentVideo = useCallback(() => {
    resetValidation();
    setFile(null);
    setAssessment(emptyHumanAssessment());
    setAssessmentNotes('');
    setAssessmentSaved(false);
    setVideoCategory('');
    if (videoRef.current) videoRef.current.removeAttribute('src');
  }, [resetValidation]);

  const updateHumanAssessment = (key: keyof HumanAssessment, value: AssessmentValue) => {
    setAssessment((previous) => ({ ...previous, [key]: value }));
    setAssessmentSaved(false);
  };

  const removeHistoryTest = (id: string) => {
    setHistory(deleteValidationTest(id, userId ?? undefined));
  };

  const removeAllHistory = () => {
    if (!window.confirm('Excluir todos os resultados do laboratório deste usuário? Os vídeos originais não estão armazenados aqui.')) return;
    clearValidationHistory(userId ?? undefined);
    setHistory([]);
  };

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Link href="/analyze" className="mb-4 inline-flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"><ArrowLeft size={14} /> Voltar à câmera</Link>
            <div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> ferramenta interna / desenvolvimento</div>
            <h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">FITAI — Laboratório de Validação</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ShieldCheck size={15} className="text-[hsl(var(--accent))]" /> processamento local · {VALIDATION_ALGORITHM_VERSION}</div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)]">
          <section className="space-y-5">
            <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-5 md:p-7">
            <div className="flex items-center gap-3">
              <FileVideo2 className="text-[hsl(var(--accent))]" size={19} />
              <div><h2 className="text-sm font-semibold">Escolha e identifique um vídeo</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">O arquivo é processado nesta aba; apenas os rótulos e o resumo do resultado entram no histórico local.</p></div>
            </div>
            <label className="mt-5 block rounded-2xl border border-dashed border-[hsl(var(--border))] p-5 text-sm">
              <span className="mb-2 block text-xs font-medium">Arquivo de vídeo</span>
              <input type="file" accept="video/*" data-testid="input-validation-video" disabled={status === 'running' || status === 'loading'} onChange={(event) => {
                resetValidation();
                const selected = event.currentTarget.files?.[0] ?? null;
                if (selected && !selected.type.startsWith('video/')) {
                  setFile(null);
                  setError('O navegador não reconheceu este arquivo como vídeo.');
                  return;
                }
                setFile(selected);
                setAssessment(emptyHumanAssessment());
                setAssessmentNotes('');
                setAssessmentSaved(false);
                setVideoCategory('');
                setResult(null);
              }} className="w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-[hsl(var(--secondary))] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[hsl(var(--secondary-foreground))]" />
            </label>
            {file && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]"><span>Identificador: {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" onClick={() => { if (window.confirm('Remover o vídeo selecionado e os resultados desta análise?')) removeCurrentVideo(); }} className="inline-flex items-center gap-1 text-[hsl(var(--accent))]"><Trash2 size={13} /> Remover vídeo</button></div>}
            {objectUrl && <video ref={videoRef} src={objectUrl} controls playsInline preload="metadata" onError={() => {
              setStatus('error');
              setError('Não foi possível decodificar este vídeo neste navegador. Tente MP4/H.264 ou outro arquivo compatível.');
            }} data-testid="video-validation" className="mt-5 max-h-[36rem] w-full rounded-xl bg-black" />}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-medium">Categoria de referência do vídeo
                <select value={videoCategory} onChange={(event) => {
                  setVideoCategory(event.currentTarget.value as ValidationCategory | '');
                  setAssessmentSaved(false);
                  setResult(null);
                }} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  <option value="">Selecione após revisar o vídeo</option>
                  {validationCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium">Separação do conjunto de dados
                <select value={partition} onChange={(event) => {
                  setPartition(event.currentTarget.value as ValidationPartition);
                  setAssessmentSaved(false);
                  setResult(null);
                }} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                  <option value="ajuste">Vídeo usado para ajustes</option>
                  <option value="avaliação-final">Avaliação final separada</option>
                </select>
              </label>
            </div>

            <div className="mt-7 rounded-2xl border border-[hsl(var(--border))] p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--accent))]">passo 1 · antes do FITAI</p><h2 className="mt-1 text-lg font-semibold">Avaliação humana independente</h2></div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${assessmentSaved ? 'bg-[hsl(var(--primary)/.14)] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{assessmentSaved ? 'avaliação registrada' : 'resultado FITAI oculto'}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Assista ao vídeo e marque cada critério antes de executar o analisador. “Não avaliável” é uma resposta válida e não entra nos cálculos binários.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {VALIDATION_CRITERIA.map(({ key, label }) => <label key={key} className="text-xs font-medium">{label}
                  <select value={assessment[key]} onChange={(event) => updateHumanAssessment(key, event.currentTarget.value as AssessmentValue)} className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
                    <option value="">Selecione</option>
                    <option value="adequado">Adequado</option>
                    <option value="inadequado">Inadequado</option>
                    <option value="não avaliável">Não avaliável</option>
                  </select>
                </label>)}
              </div>
              <label className="mt-4 block text-xs font-medium">Observações técnicas
                <textarea value={assessmentNotes} onChange={(event) => {
                  setAssessmentNotes(event.currentTarget.value);
                  setAssessmentSaved(false);
                }} rows={3} maxLength={1200} placeholder="Anote o que foi observado. Não será usado para treinamento automático." className="mt-2 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" />
              </label>
              <button type="button" onClick={() => {
                setAssessmentSaved(true);
                setResult(null);
                setError('');
              }} disabled={!assessmentComplete || !videoCategory || status === 'running' || status === 'loading'} data-testid="button-save-human-assessment" className="mt-4 rounded-full border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold disabled:opacity-45">Registrar avaliação humana</button>
              <p className="mt-3 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">Os rótulos não treinam o modelo. Alterar um critério depois exige registrar a avaliação novamente antes de processar.</p>
            </div>

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full bg-[hsl(var(--primary))] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void startValidation()} disabled={!objectUrl || !assessmentSaved || !videoCategory || status === 'loading' || status === 'running'} data-testid="button-run-validation" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--secondary-foreground))] disabled:opacity-45">
                {status === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={15} />}
                {status === 'running' ? 'Processando vídeo' : status === 'loading' ? 'Carregando modelo' : 'Processar vídeo'}
              </button>
              <button type="button" onClick={resetValidation} disabled={!file || status === 'loading'} className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] px-4 py-3 text-sm font-semibold disabled:opacity-45"><RotateCcw size={15} /> Reiniciar análise</button>
            </div>
            {status === 'running' && <p role="status" className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Analisando os frames do vídeo. Rastreamento atual: {trackingStatus}. Delegate: {delegate}.</p>}
            {error && <p role="alert" className="mt-4 rounded-xl bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}
            </div>

            <section className="rounded-[1.5rem] bg-[hsl(var(--secondary))] p-5 text-[hsl(var(--secondary-foreground))] md:p-6">
              <div className="flex items-center gap-2"><Database size={16} className="text-[hsl(var(--primary))]" /><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">conjunto real · {history.length}/{VALIDATION_DATASET_TARGET}</p><h2 className="mt-1 text-sm font-semibold">Biblioteca local de validação</h2></div></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {validationCategories.map((category) => {
                  const count = history.filter((item) => item.category === category.value).length;
                  return <div key={category.value} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-[10px] text-white/70"><span>{category.label}</span><strong className="shrink-0">{count}/10</strong></div>;
                })}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-white/55">A biblioteca começa vazia. Adicione vídeos reais e rotulados; nenhum exemplo ou resultado artificial é criado.</p>
            </section>
          </section>

          <aside className="space-y-5">
            <section className="rounded-[1.5rem] bg-[hsl(var(--secondary))] p-5 text-[hsl(var(--secondary-foreground))] md:p-6">
              <p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">passo 2 · resultado FITAI</p>
              {result ? <>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">repetições</span><strong className="mt-1 block text-2xl">{result.repetitions.length}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">frames rastreados</span><strong className="mt-1 block text-2xl">{result.trackedSamples}/{result.samples}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">confiança média</span><strong className="mt-1 block text-2xl">{result.meanConfidence === null ? '—' : `${Math.round(result.meanConfidence * 100)}%`}</strong></div>
                  <div className="rounded-xl bg-white/5 p-3"><span className="text-[10px] text-white/55">delegate final</span><strong className="mt-1 block text-2xl">{result.delegate}</strong></div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-[hsl(var(--primary))]"><CheckCircle2 size={14} /> Processamento concluído</div>
                <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
                  {VALIDATION_CRITERIA.map(({ key, label }) => {
                    const fitai = result.predictions[key];
                    const human = assessment[key];
                    const comparable = (human === 'adequado' || human === 'inadequado') && fitai !== null;
                    return <div key={key} className="rounded-xl bg-white/5 p-3">
                      <div className="flex items-center justify-between gap-2"><strong className="text-xs">{label}</strong><span className={`text-[10px] font-semibold ${!comparable ? 'text-white/45' : human === fitai ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'}`}>{!comparable ? 'não comparável' : human === fitai ? 'concorda' : 'diverge'}</span></div>
                      <p className="mt-1 text-[10px] text-white/60">Humano: {humanLabel(human)} · FITAI: {fitai ?? 'não avaliável'}</p>
                    </div>;
                  })}
                </div>
                <p className="mt-4 text-[10px] leading-4 text-white/55">FITAI classificado pela regra de referência: {validationCategories.find((item) => item.value === videoCategory)?.label}. Versão: {VALIDATION_ALGORITHM_VERSION}.</p>
              </> : <p className="mt-5 text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">{assessmentSaved ? status === 'running' ? 'O detector está processando o vídeo.' : 'A avaliação humana está registrada. O resultado permanece oculto até você iniciar o processamento.' : 'Registre primeiro os seis critérios humanos. O resultado do FITAI ficará bloqueado até lá.'}</p>}
            </section>

            {result && <section className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-5">
              <h2 className="text-sm font-semibold">Concordância neste vídeo</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{file?.name} · {partition === 'ajuste' ? 'conjunto de ajuste' : 'avaliação final'}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {calculateValidationMetrics([createValidationTestRecord({
                  fileName: file?.name ?? 'vídeo atual',
                  category: videoCategory || 'adequado',
                  partition,
                  assessment: assessment as Record<(typeof VALIDATION_CRITERIA)[number]['key'], HumanAssessmentValue>,
                  observations: assessmentNotes,
                  predictions: result.predictions,
                  repetitions: result.repetitions.length,
                  samples: result.samples,
                  trackedSamples: result.trackedSamples,
                  meanConfidence: result.meanConfidence,
                  delegate: result.delegate,
                })]).map((metric) => <div key={metric.criterion} className="rounded-xl border border-[hsl(var(--border))] p-3">
                  <p className="text-[10px] font-semibold">{metric.label}</p>
                  <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{metric.observations ? `${metric.matches}/${metric.observations} correspondências` : 'Sem par comparável'}</p>
                </div>)}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">A concordância de um vídeo não é uma estimativa geral de acurácia.</p>
            </section>}

            {(['ajuste', 'avaliação-final'] as const).map((datasetPartition) => {
              const setHistory = history.filter((item) => item.partition === datasetPartition);
              const metrics = calculateValidationMetrics(history, datasetPartition);
              return <section key={datasetPartition} className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-5">
                <div className="flex items-center justify-between gap-3"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.14em] text-[hsl(var(--accent))]">{datasetPartition === 'ajuste' ? 'conjunto de ajustes' : 'conjunto final separado'}</p><h2 className="mt-1 text-sm font-semibold">Relatório de concordância</h2></div><span className="text-xs text-[hsl(var(--muted-foreground))]">{setHistory.length} vídeos</span></div>
                <div className="mt-4 space-y-3">
                  {metrics.map((metric) => <div key={metric.criterion} className="rounded-xl border border-[hsl(var(--border))] p-3">
                    <div className="flex items-center justify-between gap-3"><strong className="text-xs">{metric.label}</strong><span className="text-[10px] text-[hsl(var(--muted-foreground))]">{metric.matches}/{metric.observations} coincidem</span></div>
                    {metric.accuracy === null
                      ? <p className="mt-2 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">Métricas não exibidas: {metric.observations}/5 observações binárias concordáveis.</p>
                      : <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[hsl(var(--muted-foreground))] sm:grid-cols-3">
                        <span>Acurácia {percent(metric.accuracy)}</span><span>Sensibilidade {percent(metric.sensitivity)}</span><span>Especificidade {percent(metric.specificity)}</span><span>Precisão {percent(metric.precision)}</span><span>F1 {percent(metric.f1)}</span><span>TP {metric.confusion.truePositive} · FP {metric.confusion.falsePositive}</span><span>TN {metric.confusion.trueNegative} · FN {metric.confusion.falseNegative}</span>
                      </div>}
                  </div>)}
                </div>
                <p className="mt-3 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">“Inadequado” é a classe positiva da matriz. “Não avaliável” não entra nos denominadores. As métricas são exploratórias e não comprovam validade científica.</p>
              </section>;
            })}

            <section className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-5">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Histórico deste navegador</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Somente resumo, rótulos e identificador; nenhum arquivo de vídeo é salvo.</p></div>{history.length > 0 && <button type="button" onClick={removeAllHistory} className="text-[10px] font-semibold text-[hsl(var(--accent))]">Excluir todos</button>}</div>
              {!history.length
                ? <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Nenhum teste real registrado. A biblioteca está vazia até que você adicione vídeos.</p>
                : <div className="mt-4 space-y-2">{history.map((item) => <article key={item.id} className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] p-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.fileName}</p><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(item.createdAt).toLocaleDateString('pt-BR')} · {validationCategories.find((category) => category.value === item.category)?.label} · {item.partition === 'ajuste' ? 'ajuste' : 'final'} · {item.repetitions} reps</p><p className="mt-1 text-[9px] text-[hsl(var(--muted-foreground))]">Algoritmo {item.algorithmVersion} · {item.samples} frames · {item.trackedSamples} rastreados</p></div>
                  <button type="button" onClick={() => { if (window.confirm(`Excluir o resultado de ${item.fileName}?`)) removeHistoryTest(item.id); }} aria-label={`Excluir resultado de ${item.fileName}`} className="rounded-lg p-2 text-[hsl(var(--accent))]"><Trash2 size={14} /></button>
                </article>)}</div>}
            </section>

            <section className="rounded-[1.25rem] border border-[hsl(var(--border))] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--accent))]">limites deste teste</p>
              <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">A avaliação humana deve ser independente. Os rótulos não treinam o modelo. Acurácia, sensibilidade, especificidade, precisão, F1 e matriz só aparecem com pelo menos cinco observações binárias por critério e conjunto; ainda assim, são exploratórias. Não declare validação científica com poucos vídeos ou avaliação do próprio desenvolvedor.</p>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
