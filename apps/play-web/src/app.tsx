// The application shell: picks the screen from the address, keeps the colour set on the root
// element, shows notices, and keeps a failing screen from blanking the page. The title, the saves and
// the creation share one stage behind them (the backdrop), kept while the player moves between them.
// In accounts mode nobody gets past the title's login without a session: the address goes to #/login
// and comes back to where it was after signing in (store/account.ts).
import { Component, type ReactNode, Suspense, lazy, useEffect } from 'react';
import { audio } from './audio';
import { pins } from './lib/params';
import { type Route, navigate, parseRoute, useRoute } from './router';
import { Backdrop } from './screens/backdrop/Backdrop';
import { ErrorBoundary } from './screens/Failure';
import { HoldingScreen } from './screens/Shell';
import { TitleScreen } from './screens/title/TitleScreen';
import { useAccount } from './store/account';
import { useUiStore } from './store/ui';
import { LoadingScreen } from './ui/Loading';
import { installTextures } from './ui/textures';
import { Toast } from './ui/Toast';
import styles from './app.module.css';

// the painted interface textures, as custom properties on the root element (ui/textures.ts)
if (typeof document !== 'undefined') installTextures();

/** The screens drawn over the shared backdrop. */
const ON_BACKDROP: ReadonlySet<Route['name']> = new Set(['title', 'login', 'saves', 'new']);

/** The screens that hold a player's data, and the login in front of them. */
const GATED: ReadonlySet<Route['name']> = new Set(['title', 'login', 'saves', 'new', 'play']);

/** A backdrop that fails leaves the page on its own colour, never a failure page. */
class Quietly extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.warn('backdrop:', error.message);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The component gallery exists only in development and screenshot builds.
const Gallery = __DEV_PAGES__ ? lazy(() => import('./screens/gallery/Gallery')) : null;
// The creation, the saves and the play screen are fetched when they are opened: the first screen does
// without them, and the play screen without the others.
const CreationScreen = lazy(() => import('./screens/creation/CreationScreen').then((m) => ({ default: m.CreationScreen })));
const SavesScreen = lazy(() => import('./screens/saves/SavesScreen').then((m) => ({ default: m.SavesScreen })));
const PlayScreen = lazy(() => import('./screens/play/PlayScreen').then((m) => ({ default: m.PlayScreen })));

function screenFor(route: Route): ReactNode {
  switch (route.name) {
    case 'title':
      return <TitleScreen />;
    case 'saves':
      return <SavesScreen />;
    case 'new':
      return <CreationScreen />;
    case 'login':
      return <TitleScreen />;
    case 'play':
      return <PlayScreen key={route.id} saveId={route.id} />;
    case 'gallery':
      return Gallery ? <Gallery section={route.section} /> : <HoldingScreen title="没有这一页" />;
    default:
      return <HoldingScreen title="没有这一页" />;
  }
}

function Notices() {
  const notices = useUiStore((s) => s.notices);
  const dismiss = useUiStore((s) => s.dismiss);
  if (notices.length === 0) return null;
  return (
    // data-toasts: a panel's or a dialog's Tab reaches them (useFocusTrap)
    <div className={styles.notices} data-toasts="">
      {notices.map((notice) => (
        <Toast
          key={notice.id}
          text={notice.text}
          kind={notice.kind}
          onDone={notice.kind === 'info' ? () => dismiss(notice.id) : undefined}
          onClose={() => dismiss(notice.id)}
          onRetry={
            notice.retry
              ? () => {
                  dismiss(notice.id);
                  notice.retry?.();
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

/** The browser chrome's colour per set: --bg of each set in ui/tokens.css (a meta tag takes no var()). */
const THEME_COLOR = { night: '#04070d', day: '#e6d6ba' } as const;

/** Keeps data-light on the root and the browser's theme colour in step with the colour set. */
function useLightOnRoot() {
  const light = useUiStore((s) => s.light);
  useEffect(() => {
    const chosen = pins().light ?? light;
    document.documentElement.dataset.light = chosen;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[chosen]);
  }, [light]);
}

/**
 * The screen to show for an address: the login while accounts mode has nobody signed in, whatever was
 * asked for; the title for #/login once nobody needs to sign in. The address follows, and the login
 * remembers what it stood in front of.
 */
function useAccountGate(route: Route): Route {
  const phase = useAccount((s) => s.phase);
  const gated = GATED.has(route.name);
  // asked once the page shows a player's screen (the gallery asks no server)
  useEffect(() => {
    if (gated) void useAccount.getState().start();
  }, [gated]);
  useEffect(() => {
    if (!gated) return;
    if (phase === 'out' && route.name !== 'login') {
      useAccount.getState().hold(location.hash);
      navigate({ name: 'login' }, { replace: true });
    } else if ((phase === 'local' || phase === 'in') && route.name === 'login') {
      navigate(parseRoute(useAccount.getState().back ?? '#/'), { replace: true });
    }
  }, [gated, phase, route.name]);
  if (!gated) return route;
  if (phase === 'out') return { name: 'login' };
  return route.name === 'login' ? { name: 'title' } : route;
}

export function App() {
  const route = useAccountGate(useRoute());
  useLightOnRoot();
  // browsers allow sound only after the player's first click, tap or key; the engine waits for it
  useEffect(() => audio.listenForGestures(), []);
  return (
    <>
      {ON_BACKDROP.has(route.name) && (
        <Quietly>
          <Backdrop />
        </Quietly>
      )}
      {/* the title and its login are one screen: signing in keeps it, and the stage, where they are */}
      <ErrorBoundary key={route.name === 'login' ? 'title' : route.name}>
        <Suspense fallback={<LoadingScreen />}>{screenFor(route)}</Suspense>
        <Notices />
      </ErrorBoundary>
    </>
  );
}
