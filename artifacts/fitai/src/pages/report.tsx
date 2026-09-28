import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, CircleHelp, Info, RotateCcw, ShieldCheck, Target } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { loadReport, type FitaiReport } from '@/lib/fitai-analysis';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace('.', '');
}

export default function Report() {
  const [report, setReport] = useState<FitaiReport | null>(null);
  useEffect(() => setReport(loadReport()), []);

  return (
    <AppShell>
      <div className="page-enter">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div><div className="mb-3 flex items-center gap-2 font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> histórico / squat 01</div><h1 className="text-4xl font-semibold tracking-[-.06em] md:text-5xl">Seu relatório</h1></div>
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
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Faça uma análise de agachamento para ver repetições completas, profundidade e execução.</p>
      <Link href="/analyze" data-testid="button-empty-start-analysis" className="mx-auto mt-8 flex w-fit items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))]">Iniciar análise <ArrowRight size={16} className="text-[hsl(var(--primary))]" /></Link>
    </section>
  );
}

function ReportContent({ report, onClear }: { report: FitaiReport; onClear: () => void }) {
  const index = report.executionIndex;
  return (
    <>
      <section className="grid gap-5 md:grid-cols-[1.25fr_.75fr]">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-[hsl(var(--secondary))] p-6 text-[hsl(var(--secondary-foreground))] md:p-8">
          <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[hsl(var(--primary)/.15)] blur-2xl" />
          <div className="relative flex items-start justify-between">
            <div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--secondary-foreground)/.55)]">resultado da sessão</p><h2 className="mt-4 text-xl font-semibold tracking-[-.03em]">Índice experimental de execução</h2><p className="mt-2 max-w-md text-sm leading-6 text-[hsl(var(--secondary-foreground)/.6)]">Uma leitura resumida das repetições completas que o FITAI conseguiu acompanhar.</p></div>
            <Target size={22} className="text-[hsl(var(--primary))]" />
          </div>
          <div className="relative mt-9 flex items-end gap-4"><span data-testid="text-execution-index" className="font-mono-fitai text-7xl font-medium leading-none tracking-[-.1em] text-[hsl(var(--primary))]">{index ?? '—'}</span><span className="mb-2 font-mono-fitai text-xs text-[hsl(var(--secondary-foreground)/.5)]">/ 100</span></div>
          <div className="relative mt-6 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--secondary-foreground)/.12)]"><div data-testid="progress-execution-index" className="h-full rounded-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${index ?? 0}%` }} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-1 md:grid-rows-2">
          <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] p-5"><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">repetições válidas</p><p data-testid="text-valid-repetitions" className="mt-4 text-4xl font-semibold tracking-[-.06em]">{report.repetitions.length.toString().padStart(2, '0')}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">ciclos completos</p></div>
          <div className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] p-5"><p className="font-mono-fitai text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">confiabilidade</p><p data-testid="text-report-reliability" className="mt-4 flex items-center gap-2 text-xl font-semibold tracking-[-.04em]"><ShieldCheck size={19} className="text-[hsl(var(--accent))]" /> suficiente</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">pose visível durante a sessão</p></div>
        </div>
      </section>
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between"><div><p className="font-mono-fitai text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">detalhe por ciclo</p><h2 className="mt-2 text-2xl font-semibold tracking-[-.05em]">Repetições</h2></div><span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">agachamento</span></div>
        <div className="overflow-hidden rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.5)]">
          <div className="hidden grid-cols-[.45fr_1fr_1fr_1fr_1.55fr] gap-4 border-b border-[hsl(var(--border))] px-5 py-3 font-mono-fitai text-[10px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] md:grid"><span>#</span><span>índice</span><span>profundidade</span><span>ângulo mín.</span><span>leitura</span></div>
          {report.repetitions.map((rep) => <div key={rep.id} data-testid={`row-repetition-${rep.id}`} className="grid gap-3 border-b border-[hsl(var(--border)/.75)] px-5 py-4 last:border-0 md:grid-cols-[.45fr_1fr_1fr_1fr_1.55fr] md:items-center md:gap-4"><div className="flex items-center justify-between md:block"><span className="font-mono-fitai text-sm text-[hsl(var(--muted-foreground))]">{String(rep.id).padStart(2, '0')}</span><span className="rounded-full bg-[hsl(var(--primary)/.2)] px-2 py-1 text-xs font-semibold text-[hsl(var(--foreground))] md:hidden">{rep.executionIndex}/100</span></div><div className="flex items-center gap-3"><span className="hidden h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))] md:block" /><span className="text-xs text-[hsl(var(--muted-foreground))] md:hidden">Índice</span><strong className="hidden font-mono-fitai text-sm md:block">{rep.executionIndex}<span className="text-[hsl(var(--muted-foreground))]">/100</span></strong></div><div><span className="text-xs text-[hsl(var(--muted-foreground))] md:hidden">Profundidade · </span><strong className="text-sm">{rep.depthPercent}%</strong></div><div><span className="text-xs text-[hsl(var(--muted-foreground))] md:hidden">Ângulo mínimo · </span><strong className="text-sm">{rep.minKneeAngle}°</strong></div><div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><ChevronRight size={14} className="hidden text-[hsl(var(--accent))] md:block" />{rep.note}</div></div>)}
        </div>
      </section>
      <section className="mt-8 grid gap-4 md:grid-cols-[1.3fr_.7fr]">
        <div className="flex gap-3 rounded-[1.5rem] bg-[hsl(var(--muted)/.72)] p-5"><Info size={17} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><div><h3 className="text-sm font-semibold">Como ler este índice</h3><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Ele combina a profundidade observada e a duração do ciclo. Serve para comparar suas próprias sessões, não para medir saúde ou técnica absoluta.</p></div></div>
        <div className="flex items-center justify-between rounded-[1.5rem] border border-[hsl(var(--border))] p-5"><div className="flex gap-3"><CircleHelp size={17} className="mt-0.5 text-[hsl(var(--accent))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Quer tentar de novo?</p></div><Link href="/analyze" data-testid="button-report-repeat" className="rounded-full bg-[hsl(var(--secondary))] p-2.5 text-[hsl(var(--secondary-foreground))]"><RotateCcw size={16} /></Link></div>
      </section>
      <div className="mt-8 flex items-center justify-between border-t border-[hsl(var(--border))] pt-5"><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Não é diagnóstico, avaliação médica ou precisão biomecânica absoluta.</p><button type="button" onClick={onClear} data-testid="button-clear-report" className="text-xs font-medium text-[hsl(var(--muted-foreground))] underline-offset-4 hover:underline">Limpar relatório</button></div>
    </>
  );
}