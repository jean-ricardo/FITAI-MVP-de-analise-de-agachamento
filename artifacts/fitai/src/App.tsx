import { type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ptBR } from '@clerk/localizations';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import Analyze from '@/pages/analyze';
import Report from '@/pages/report';
import Validation from '@/pages/validation';
import {
  Route,
  Redirect,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not configured.');
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(76 94% 42%)',
    colorForeground: 'hsl(222 29% 13%)',
    colorMutedForeground: 'hsl(218 12% 43%)',
    colorDanger: 'hsl(4 76% 45%)',
    colorBackground: 'hsl(42 40% 95%)',
    colorInput: 'hsl(45 43% 98%)',
    colorInputForeground: 'hsl(222 29% 13%)',
    colorNeutral: 'hsl(38 20% 78%)',
    fontFamily: 'Space Grotesk, sans-serif',
    borderRadius: '1rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f1] border border-[#ded8cb] shadow-xl rounded-[1.5rem] w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1d2433] font-semibold',
    headerSubtitle: 'text-[#686f7a]',
    socialButtonsBlockButtonText: 'text-[#1d2433]',
    formFieldLabel: 'text-[#1d2433]',
    footerActionLink: 'text-[#1d2433]',
    footerActionText: 'text-[#686f7a]',
    dividerText: 'text-[#686f7a]',
    identityPreviewEditButton: 'text-[#1d2433]',
    formFieldSuccessText: 'text-[#217a40]',
    alertText: 'text-[#1d2433]',
    logoBox: 'mx-auto',
    logoImage: 'h-9 w-9',
    socialButtonsBlockButton: '!bg-white !border-[#ded8cb] hover:!bg-[#f0eee7]',
    formButtonPrimary: '!bg-[#1d2433] !text-white hover:!bg-[#2d3748]',
    formFieldInput: '!bg-white !border-[#ded8cb] !text-[#1d2433]',
    footerAction: 'bg-transparent',
    dividerLine: '!bg-[#ded8cb]',
    alert: '!bg-[#fff5f4] !border-[#e6aaa4]',
    otpCodeFieldInput: '!bg-white !border-[#ded8cb] !text-[#1d2433]',
    formFieldRow: 'mb-3',
    main: 'p-6 sm:p-8',
  },
};

function AuthLoading() {
  return (
    <div
      className="flex min-h-[55vh] items-center justify-center gap-3 text-sm text-[hsl(var(--muted-foreground))]"
      role="status"
      data-testid="status-auth-loading"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--primary))]" />
      Carregando sua sessão…
    </div>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <Redirect to="/analyze" /> : <Home />;
}

function ProtectedPage({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn) return <Redirect to="/" />;
  return children;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4 py-10">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] px-4 py-10">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/analyze">
          <ProtectedPage><Analyze /></ProtectedPage>
        </Route>
        <Route path="/report">
          <ProtectedPage><Report /></ProtectedPage>
        </Route>
        {import.meta.env.DEV && (
          <Route path="/validation">
            <ProtectedPage><Validation /></ProtectedPage>
          </Route>
        )}
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={ptBR}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <Router />
    </ClerkProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
