import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, CircleAlert, CircleHelp, Info, RotateCcw, ShieldCheck, Target, X } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { loadReport, type ChecklistStatus, type FitaiReport, type RepMetric } from '@/lib/fitai-analysis';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace('.', '');
}

function statusClass(status: ChecklistStatus) {
  return status === 'OK'
    ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/.14)]'
    : status === 'ATENÇÃO'
      ? 'text-[hsl(var(--accent))] bg-[hsl(var(--accent)/.14)]'
      : 'text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]';
}

function StatusIcon({ status }: { status: ChecklistStatus }) {
  return status === 'OK' ? <Check size={13} strokeWidth={3} /> : status === 'ATENÇÃO' ? <CircleAlert size={13} /> : <X size={13} />;
}

export default function Report() {
  const [report, setReport] = useState<FitaiReport | null>(null);
  useEffect(() => setReport(loadReport()), []);

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div><div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> histórico / squat lateral</div><h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Análise do seu agachamento</h1></div>
          {report && <div data-testid="text-report-date" className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><CalendarDays size={15} /> {formatDate(report.completedAt)}</div>}
        </div>
        {!report ? <EmptyReport /> : <ReportContent report={report} onClear={() => { localStorage.removeItem('fitai:last-report'); setReport(null); }} />}
      </div>
    </AppShell>
  );
}

function EmptyReport() {
  return (
    <section data-testid="status-report-empty" className="mx-auto max-w-2xl rounded-[1.75rem] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] px-6 py-16 text-center md:px-12">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--accent))]"><BarChart3 size={26} /></div>
      <p className="mt-7 font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">nenhuma sessão salva</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-.04em]">Seu próximo movimento começa aqui.</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Faça uma análise lateral para ver as fases, os critérios avaliáveis e as prioridades da próxima execução.</p>
      <Link href="/analyze" data-testid="button-empty-start-analysis" className="mx-auto mt-8 flex w-fit items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]">Iniciar análise <ArrowRight size={16} className="text-[hsl(var(--primary))]" /></Link>
    </section>
  );
}

function consistency(repetitions: RepMetric[]) {
  if (repetitions.length < 2) return null;
  const values = repetitions.map((rep) => rep.executionIndex);
  const range = Math.max(...values) - Math.min(...values);
  return Math.round(Math.max(0, 100 - range * 2));
}

function ReportContent({ report, onClear }: { report: FitaiReport; onClear: () => void }) {
  const repetitions = report.repetitions ?? [];
  const index = report.executionIndex;
  const best = repetitions.length ? Math.max(...repetitions.map((rep) => rep.executionIndex)) : null;
  const worst = repetitions.length ? Math.min(...repetitions.map((rep) => rep.executionIndex)) : null;
  const stable = consistency(repetitions);
  const phaseAnalysis = report.phaseAnalysis ?? [];
  const chartMax = Math.max(...repetitions.map((rep) => rep.executionIndex), 100);
  const [openRep, setOpenRep] = useState<number | null>(repetitions[0]?.id ?? null);
  const phaseLabel: Record<string, string> = { SETUP: 'Setup', DESCIDA: 'Descida', PROFUNDIDADE: 'Profundidade', SUBIDA: 'Subida', FINALIZAÇÃO: 'Finalização' };
  const comparison = report.previousComparison;
  const trendText = comparison?.message;

  const topPositive = useMemo(() => (report.positives ?? []).slice(0, 3), [report.positives]);

  return (
    <>
      <section className="grid gap-5 md:grid-cols-[1.25fr_.75fr]">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-[hsl(var(--secondary))] p-6 text-[hsl(var(--secondary-foreground))] md:p-8">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[hsl(var(--primary)/.15)] blur-2xl" />
          <div className="relative flex items-start justify-between"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">resultado da sessão</p><h2 className="mt-4 text-xl font-semibold tracking-[-.03em]">Índice experimental de execução</h2><p className="mt-2 max-w-md text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">Uma leitura das repetições completas que o FITAI conseguiu acompanhar com dados suficientes.</p></div><Target size={22} className="text-[hsl(var(--primary))]" /></div>
          <div className="relative mt-9 flex items-end gap-4"><span data-testid="text-execution-index" className="font-mono-fitai text-7xl font-medium leading-none tracking-[-.1em] text-[hsl(var(--primary))]">{index ?? '—'}</span><span className="mb-2 font-mono-fitai text-xs text-[hsl(var(--secondary-foreground)/.5)]">/ 100</span></div>
          <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--secondary-foreground)/.12)]"><div data-testid="progress-execution-index" className="h-full rounded-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${index ?? 0}%` }} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
          <MetricCard label="repetições válidas" value={repetitions.length.toString().padStart(2, '0')} detail="ciclos completos" testId="text-valid-repetitions" />
          <MetricCard label="consistência" value={stable === null ? '—' : `${stable}%`} detail="variação entre repetições" testId="text-consistency" />
          <MetricCard label="melhor repetição" value={best === null ? '—' : `${best}`} detail="índice experimental" testId="text-best-repetition" />
          <MetricCard label="menor repetição" value={worst === null ? '—' : `${worst}`} detail="índice experimental" testId="text-worst-repetition" />
        </div>
      </section>

      {trendText && <div data-testid="status-report-comparison" className="mt-5 flex items-center gap-3 rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-4 text-sm"><BarChart3 size={17} className="text-[hsl(var(--accent))]" /><span>{trendText}</span>{comparison && comparison.indexDelta !== null && <strong className={comparison.indexDelta >= 0 ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--accent))]'}>{comparison.indexDelta > 0 ? '+' : ''}{comparison.indexDelta} pts</strong>}</div>}

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)] p-5 md:p-6">
          <div className="mb-5"><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">leitura por fase</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">Análise por fase</h2></div>
          <div className="space-y-3">
            {(phaseAnalysis.length ? phaseAnalysis : []).map((phase) => <div key={phase.phase} data-testid={`phase-summary-${phase.phase.toLowerCase()}`} className="flex items-center gap-3 rounded-xl bg-[hsl(var(--muted)/.55)] px-4 py-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${statusClass(phase.status)}`}><StatusIcon status={phase.status} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{phaseLabel[phase.phase] ?? phase.phase}</strong><span className={`text-[10px] font-semibold uppercase tracking-[.12em] ${phase.status === 'ATENÇÃO' ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{phase.status}</span></div><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{phase.detail}</p></div></div>)}
            {!phaseAnalysis.length && <p className="text-sm text-[hsl(var(--muted-foreground))]">Os detalhes por fase estarão disponíveis na próxima sessão analisada.</p>}
          </div>
        </div>
        <div className="rounded-[1.5rem] bg-[hsl(var(--secondary))] p-5 text-[hsl(var(--secondary-foreground))] md:p-6">
          <div className="flex items-center justify-between"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">consistência da série</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">Índice por repetição</h2></div><BarChart3 size={20} className="text-[hsl(var(--primary))]" /></div>
          <div className="mt-8 flex h-40 items-end gap-2 border-b border-[hsl(var(--secondary-foreground)/.14)] pb-0">{repetitions.map((rep) => <div key={rep.id} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="font-mono-fitai text-[10px] text-[hsl(var(--secondary-foreground)/.7)]">{rep.executionIndex}</span><div data-testid={`chart-repetition-${rep.id}`} className="w-full max-w-8 rounded-t-md bg-[hsl(var(--primary))] transition-all" style={{ height: `${Math.max(8, (rep.executionIndex / chartMax) * 100)}%` }} /><span className="font-mono-fitai text-[9px] text-[hsl(var(--secondary-foreground)/.5)]">{rep.id}</span></div>)}</div>
          <p className="mt-4 text-xs leading-5 text-[hsl(var(--secondary-foreground)/.58)]">{repetitions.length >= 3 && repetitions[repetitions.length - 1].executionIndex < repetitions[0].executionIndex - 4 ? 'Foi observada redução gradual do índice nas últimas repetições.' : 'Acompanhe este gráfico para perceber tendências dentro da série.'}</p>
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
        <div className="space-y-5">
          <InsightPanel title="Como melhorar na próxima execução" eyebrow="1–3 prioridades" icon={<Target size={18} />} items={report.priorities ?? []} empty="Nenhum alerta recorrente foi confirmado nesta sessão." accent />
          <InsightPanel title="Pontos positivos observados" eyebrow="baseado nos dados" icon={<Check size={18} />} items={topPositive} empty="Ainda não houve dados suficientes para confirmar um padrão positivo." />
        </div>
        <div>
          <div className="mb-4 flex items-end justify-between"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">detalhe por ciclo</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">Repetições</h2></div><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">agachamento lateral</span></div>
          <div className="space-y-3">{repetitions.map((rep) => <RepCard key={rep.id} rep={rep} open={openRep === rep.id} onToggle={() => setOpenRep(openRep === rep.id ? null : rep.id)} />)}</div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-[1.3fr_.7fr]">
        <div className="flex gap-3 rounded-[1.5rem] bg-[hsl(var(--muted)/.72)] p-5"><Info size={17} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><div><h3 className="text-sm font-semibold">Como interpretar</h3><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Profundidade é uma característica da execução, não uma regra universal. O índice combina profundidade, controle, estabilidade e coordenação quando esses critérios puderam ser avaliados.</p>{(report.limitations ?? []).map((limitation) => <p key={limitation} className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">• {limitation}</p>)}</div></div>
        <div className="flex items-center justify-between rounded-[1.5rem] border border-[hsl(var(--border))] p-5"><div className="flex gap-3"><CircleHelp size={17} className="mt-0.5 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Quer tentar de novo?</p></div><Link href="/analyze" data-testid="button-report-repeat" className="rounded-full bg-[hsl(var(--secondary))] p-2.5 text-[hsl(var(--secondary-foreground))]"><RotateCcw size={16} /></Link></div>
      </section>
      <div className="mt-8 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5"><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">A análise é uma estimativa por visão computacional e não substitui avaliação profissional.</p><button type="button" onClick={onClear} data-testid="button-clear-report" className="text-xs font-medium text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline">Limpar relatório</button></div>
    </>
  );
}

function MetricCard({ label, value, detail, testId }: { label: string; value: string; detail: string; testId: string }) {
  return <div className="rounded-[1.25rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] p-4"><p className="font-mono-fitai text-[9px] uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))]">{label}</p><p data-testid={testId} className="mt-3 text-3xl font-semibold tracking-[-.06em]">{value}</p><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{detail}</p></div>;
}

function InsightPanel({ title, eyebrow, icon, items, empty, accent = false }: { title: string; eyebrow: string; icon: ReactNode; items: string[]; empty: string; accent?: boolean }) {
  return <div className={`rounded-[1.5rem] border p-5 md:p-6 ${accent ? 'border-[hsl(var(--accent)/.28)] bg-[hsl(var(--accent)/.06)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)]'}`}><div className="flex items-start gap-3"><span className={`mt-0.5 ${accent ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--primary))]'}`}>{icon}</span><div className="min-w-0"><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">{eyebrow}</p><h2 className="mt-2 text-xl font-semibold tracking-[-.04em]">{title}</h2></div></div><div className="mt-5 space-y-3">{items.length ? items.map((item, index) => <div key={item} className="flex gap-3 text-sm leading-5"><span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">0{index + 1}</span><p>{item}</p></div>) : <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">{empty}</p>}</div></div>;
}

function RepCard({ rep, open, onToggle }: { rep: RepMetric; open: boolean; onToggle: () => void }) {
  const checklist = rep.checklist ?? [];
  return <article data-testid={`row-repetition-${rep.id}`} className="overflow-hidden rounded-[1.35rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)]"><button type="button" onClick={onToggle} data-testid={`button-repetition-${rep.id}`} className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[hsl(var(--muted)/.4)]"><span className="font-mono-fitai text-sm text-[hsl(var(--muted-foreground))]">{String(rep.id).padStart(2, '0')}</span><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" /><span className="flex-1"><strong className="text-sm">{rep.executionIndex}/100</strong><span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">{rep.depthLabel}</span></span><span className="text-xs text-[hsl(var(--muted-foreground))]">{rep.note}</span><ChevronRight size={16} className={`text-[hsl(var(--muted-foreground))] transition-transform ${open ? 'rotate-90' : ''}`} /></button>{open && <div className="border-t border-[hsl(var(--border))] px-5 pb-5 pt-4"><div className="grid gap-3 sm:grid-cols-2">{checklist.length ? checklist.map((item) => <div key={item.key} data-testid={`checklist-${rep.id}-${item.key}`} className="rounded-xl bg-[hsl(var(--muted)/.56)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{item.label}</span><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${statusClass(item.status)}`}><StatusIcon status={item.status} /> {item.status}</span></div><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{item.detail}</p>{item.feedback && <p className="mt-2 text-xs leading-5 text-[hsl(var(--foreground))]">{item.feedback}</p>}</div>) : <p className="text-sm text-[hsl(var(--muted-foreground))]">Esta sessão foi criada antes da análise por fases. Faça uma nova sessão para gerar o checklist completo.</p>}</div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-[hsl(var(--muted-foreground))] sm:grid-cols-4">{Object.entries(rep.scoreBreakdown ?? {}).map(([key, value]) => <div key={key} className="rounded-lg border border-[hsl(var(--border))] p-2"><span className="block uppercase tracking-[.1em]">{key}</span><strong className="mt-1 block text-sm text-[hsl(var(--foreground))]">{value === null ? '—' : value}</strong></div>)}</div>{rep.feedback?.length > 0 && <div className="mt-4 rounded-xl border border-[hsl(var(--accent)/.22)] bg-[hsl(var(--accent)/.06)] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--accent))]">orientação para a próxima execução</p>{rep.feedback.slice(0, 3).map((message) => <p key={message} className="mt-2 text-xs leading-5">{message}</p>)}</div>}</div>}</article>;
}