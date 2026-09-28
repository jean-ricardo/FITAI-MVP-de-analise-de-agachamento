import { ArrowUpRight, Camera, Check, LockKeyhole, MoveUpRight, ScanLine } from 'lucide-react';
import { Link } from 'wouter';
import { AppShell } from '@/components/app-shell';

export default function Home() {
  return (
    <AppShell>
      <div className="page-enter">
        <section className="grid items-end gap-10 pb-14 pt-8 md:grid-cols-[1.08fr_.92fr] md:pb-20 md:pt-10">
          <div className="rise-in max-w-3xl">
            <div className="mb-7 flex items-center gap-3 text-xs font-medium uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">
              <span className="h-px w-8 bg-[hsl(var(--accent))]" /> análise de movimento • mvp local
            </div>
            <h1 className="text-balance text-[clamp(3.35rem,9vw,7.3rem)] font-semibold leading-[.88] tracking-[-.075em]">
              Treine melhor.<br /><span className="text-[hsl(var(--accent))]">Execute melhor.</span><br />Evolua.
            </h1>
            <p className="mt-8 max-w-md text-base leading-7 text-[hsl(var(--muted-foreground))]">
              Um olhar cuidadoso para o seu agachamento. Feedback prático, direto e processado no seu dispositivo — sem enviar vídeo para lugar nenhum.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/analyze" data-testid="button-quick-start" className="group flex items-center gap-3 rounded-full bg-[hsl(var(--secondary))] px-5 py-3.5 text-sm font-semibold text-[hsl(var(--secondary-foreground))] transition-transform hover:-translate-y-1">
                <Camera size={17} className="text-[hsl(var(--primary))]" /> Começar análise
                <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <span className="font-mono-fitai text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">sem cadastro · 100% local</span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md rise-in delay-1">
            <div className="relative aspect-[.9] overflow-hidden rounded-[2rem] bg-[hsl(var(--secondary))] p-5 text-[hsl(var(--secondary-foreground))] shadow-2xl shadow-[hsl(222_29%_13%/.16)]">
              <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[hsl(var(--primary)/.88)] blur-2xl" />
              <div className="relative flex items-center justify-between text-[10px] uppercase tracking-[.18em] text-[hsl(var(--secondary-foreground)/.55)]">
                <span>live / squat 01</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" /> local</span>
              </div>
              <div className="relative mt-7 flex h-[62%] items-center justify-center">
                <div className="absolute h-48 w-48 rounded-full border border-[hsl(var(--primary)/.3)]" />
                <div className="absolute h-72 w-72 rounded-full border border-dashed border-[hsl(var(--secondary-foreground)/.12)]" />
                <div className="relative flex h-44 w-32 flex-col items-center">
                  <div className="h-12 w-12 rounded-full border-[3px] border-[hsl(var(--primary))]" />
                  <div className="relative h-16 w-16 border-x-[3px] border-[hsl(var(--primary))]">
                    <span className="absolute -left-7 top-2 h-12 w-10 -rotate-[18deg] rounded-bl-2xl border-b-[3px] border-l-[3px] border-[hsl(var(--primary))]" />
                    <span className="absolute -right-7 top-2 h-12 w-10 rotate-[18deg] rounded-br-2xl border-b-[3px] border-r-[3px] border-[hsl(var(--primary))]" />
                  </div>
                  <div className="flex h-16 w-20 justify-between border-t-[3px] border-[hsl(var(--primary))] pt-1">
                    <span className="h-14 w-6 -rotate-[18deg] rounded-b-xl border-l-[3px] border-b-[3px] border-[hsl(var(--primary))]" />
                    <span className="h-14 w-6 rotate-[18deg] rounded-b-xl border-r-[3px] border-b-[3px] border-[hsl(var(--primary))]" />
                  </div>
                </div>
              </div>
              <div className="relative flex items-end justify-between border-t border-[hsl(var(--secondary-foreground)/.12)] pt-4">
                <div><p className="font-mono-fitai text-[10px] text-[hsl(var(--secondary-foreground)/.5)]">estado</p><p className="mt-1 text-sm font-semibold">EM PÉ</p></div>
                <div className="text-right"><p className="font-mono-fitai text-[10px] text-[hsl(var(--secondary-foreground)/.5)]">reps</p><p className="mt-1 text-2xl font-semibold text-[hsl(var(--primary))]">00</p></div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-3 flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs shadow-lg md:-left-8">
              <ScanLine size={16} className="text-[hsl(var(--accent))]" /> observando movimento
            </div>
          </div>
        </section>

        <section className="grid gap-4 border-t border-[hsl(var(--border))] py-10 md:grid-cols-[1.1fr_.9fr] md:gap-16 md:py-14">
          <div>
            <p className="font-mono-fitai text-[10px] uppercase tracking-[.17em] text-[hsl(var(--accent))]">o primeiro passo</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-[-.05em] md:text-4xl">A câmera observa. Você se concentra no movimento.</h2>
          </div>
          <div className="space-y-5 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            <div className="flex gap-4"><span className="font-mono-fitai text-[hsl(var(--foreground))]">01</span><p>Posicione o celular de lado, enquadre o corpo inteiro e comece quando estiver pronto.</p></div>
            <div className="flex gap-4"><span className="font-mono-fitai text-[hsl(var(--foreground))]">02</span><p>O FITAI acompanha cada fase do agachamento e conta apenas ciclos completos e visíveis.</p></div>
            <div className="flex gap-4"><span className="font-mono-fitai text-[hsl(var(--foreground))]">03</span><p>Ao finalizar, reveja repetições, profundidade e um índice experimental transparente.</p></div>
          </div>
        </section>

        <section className="rounded-[1.75rem] bg-[hsl(var(--secondary))] p-6 text-[hsl(var(--secondary-foreground))] md:flex md:items-center md:justify-between md:p-10">
          <div className="flex gap-4">
            <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><Check size={18} strokeWidth={3} /></div>
            <div><h2 className="text-xl font-semibold tracking-[-.03em]">Seu vídeo fica no seu aparelho.</h2><p className="mt-1 max-w-lg text-sm leading-6 text-[hsl(var(--secondary-foreground)/.62)]">A análise usa processamento local no navegador. O FITAI não faz upload, não armazena vídeo e não precisa de login.</p></div>
          </div>
          <Link href="/analyze" data-testid="link-privacy-start" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--primary))] md:mt-0">Ver como funciona <MoveUpRight size={15} /></Link>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          {[['Análise em tempo real', 'Landmarks de pose e estado do movimento aparecem sobre a imagem.'], ['Feedback sem exagero', 'O índice experimental só aparece quando há dados suficientes para calculá-lo.'], ['Próximos movimentos', 'Flexão e levantamento terra ainda não estão disponíveis — e tudo bem.']].map(([title, body], index) => (
            <div key={title} className="rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.55)] p-5">
              <span className="font-mono-fitai text-xs text-[hsl(var(--accent))]">0{index + 1}</span><h3 className="mt-8 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{body}</p>
            </div>
          ))}
        </section>
        <p className="mt-10 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><LockKeyhole size={14} /> O índice é experimental, não é diagnóstico, avaliação médica ou precisão biomecânica absoluta.</p>
      </div>
    </AppShell>
  );
}