import type { ReactNode } from 'react';
import { Activity, BarChart3, Camera, ChevronRight } from 'lucide-react';
import { Link, useLocation } from 'wouter';

const navItems = [
  { href: '/', label: 'Visão geral', icon: Activity },
  { href: '/analyze', label: 'Analisar', icon: Camera },
  { href: '/report', label: 'Relatório', icon: BarChart3 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="app-noise min-h-[100dvh]">
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border)/.75)] bg-[hsl(var(--background)/.92)] backdrop-blur-xl">
        <div className="mx-auto flex h-[4.5rem] max-w-[1400px] items-center justify-between px-5 md:px-10">
          <Link href="/" data-testid="link-logo" className="group flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-transform group-hover:rotate-6">
              <Activity size={19} strokeWidth={2.8} />
            </span>
            <span className="text-lg font-bold tracking-[-.04em]">FITAI<span className="text-[hsl(var(--accent))]">.</span></span>
          </Link>
          <div className="hidden items-center gap-8 text-sm font-medium text-[hsl(var(--muted-foreground))] md:flex">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-2 transition-colors hover:text-[hsl(var(--foreground))] ${location === href ? 'text-[hsl(var(--foreground))]' : ''}`}>
                <Icon size={16} strokeWidth={location === href ? 2.5 : 1.8} />
                {label}
              </Link>
            ))}
          </div>
          <Link href="/analyze" data-testid="button-header-start" className="hidden items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-4 py-2.5 text-xs font-semibold text-[hsl(var(--secondary-foreground))] transition-transform hover:-translate-y-0.5 sm:flex">
            Começar análise <ChevronRight size={14} />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-5 pb-24 pt-8 md:px-10 md:pb-16 md:pt-12">
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-[hsl(var(--border)/.85)] bg-[hsl(var(--background)/.94)] px-5 pb-[max(.7rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={`flex min-w-16 flex-col items-center gap-1 py-1 text-[10px] font-medium ${location === href ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
              <Icon size={19} strokeWidth={location === href ? 2.5 : 1.8} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}