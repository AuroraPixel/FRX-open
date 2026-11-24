// Who is playing (docs/accounts-and-isolation-plan.md, 页面; spec 七, 账号). The page starts by asking the
// server: in local mode there is nobody to sign in and nothing about accounts shows; in accounts mode a
// player without a session meets the login on the title page, and is taken back to where they were
// going once signed in. A request that finds the session gone (401) sends them there too, saying what
// became of the turn being sent, and brings them back to it.
//
// Changing players: the browser's player keys are cleared when another account's data is about to be
// read (lib/player-data.ts), and a page that has shown one player's saves starts afresh before showing
// another's, so nothing of theirs stays in memory either. Signing out clears and starts afresh too.
import { create } from 'zustand';
import { accountApi } from '../api/account';
import { ApiError, whenSignedOut } from '../api/client';
import type { Account, AccountOptions, EmailCodeSent } from '../contracts';
import { claimPlayerData, forgetPlayerData, setDataOwner } from '../lib/player-data';
import { navigate, parseRoute } from '../router';
import { useUiStore } from './ui';

/** checking: the first question to the server is out; local: no accounts; in, out: signed in or not */
export type Phase = 'checking' | 'local' | 'in' | 'out';

/** The session went while a player was signed in: where they were, and what became of their turn. */
export interface Lapse {
  /** the address to go back to */
  from: string;
  /** the account that lapsed; the login starts with its name */
  username?: string;
  email?: string;
  /** unsent: the server never took the turn; running: it goes on on the server */
  turn?: 'unsent' | 'running';
}

export interface AccountStore {
  phase: Phase;
  options: AccountOptions | null;
  account: Account | null;
  /** the user whose saves this page has shown: someone else signing in starts the page afresh */
  holder: string | null;
  /** the address the login stood in front of */
  back: string | null;
  lapse: Lapse | null;
  /** what the page said before it started afresh (「已退出。」), for the login to show */
  notice: string | null;
  /** asks the server who is here; once per page */
  start: () => Promise<void>;
  loadOptions: () => Promise<void>;
  /** authentication actions throw the server's ApiError for the form to show */
  signIn: (username: string, password: string) => Promise<void>;
  sendEmailCode: (email: string) => Promise<EmailCodeSent>;
  signInEmail: (email: string, code: string) => Promise<void>;
  register: (username: string, password: string, invite?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** a request found the session gone */
  lapsed: () => void;
  /** the login stands in front of this address: go there after signing in */
  hold: (address: string) => void;
  /** the account again: its usage and limits */
  refresh: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  /** what became of the turn being sent when the session went (store/turns.ts says) */
  noteTurn: (turn: 'unsent' | 'running') => void;
}

/** A notice that outlives the page starting afresh (signed out, another player signed in); read once. */
const NOTICE_KEY = 'frx.play.notice';

function leaveNotice(text: string): void {
  try {
    globalThis.sessionStorage?.setItem(NOTICE_KEY, text);
  } catch {
    // the notice is lost; the page still shows where it is
  }
}

/** The notice left before the page started afresh, removed as it is read. */
export function takeNotice(): string | null {
  try {
    const text = globalThis.sessionStorage?.getItem(NOTICE_KEY) ?? null;
    if (text !== null) globalThis.sessionStorage?.removeItem(NOTICE_KEY);
    return text;
  } catch {
    return null;
  }
}

/** Starting the page afresh at an address. Tests replace it. */
export const page = {
  restart(address: string): void {
    history.replaceState(null, '', address);
    location.reload();
  },
};

const LOGIN = '#/login';

function here(): string {
  return globalThis.location?.hash || '#/';
}

function isLogin(address: string): boolean {
  return parseRoute(address).name === 'login';
}

function unauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthorized';
}

export const INITIAL = {
  phase: 'checking' as Phase,
  options: null,
  account: null,
  holder: null,
  back: null,
  lapse: null,
  notice: null,
};

/** What signing in says: who, and what became of the turn the session went under. */
function welcomeNote(account: Account, lapse: Lapse | null, registered: boolean): string {
  const who = registered ? `注册好了，已登录：${account.user.username}。` : `已登录：${account.user.username}。`;
  if (lapse?.turn === 'unsent') return `${who}刚才那一回合没有发出去，你写的行动还在输入框里。`;
  if (lapse?.turn === 'running') return `${who}接着看刚才那一回合。`;
  return who;
}

let starting = false;

export const useAccount = create<AccountStore>()((set, get) => {
  /** This account's data is what the page reads now. */
  function adopt(account: Account, settled: Partial<AccountStore> = {}) {
    claimPlayerData(account.user.id);
    set({ account, holder: account.user.id, phase: account.mode === 'local' ? 'local' : 'in', ...settled });
  }

  /** Signed in: back to where the player was going, or afresh when the page held someone else's. */
  function welcome(account: Account, registered: boolean) {
    const { holder, lapse, back } = get();
    if (holder !== null && holder !== account.user.id) {
      claimPlayerData(account.user.id);
      leaveNotice(welcomeNote(account, null, registered));
      page.restart('#/');
      return;
    }
    adopt(account, { lapse: null, back: null, notice: null });
    navigate(parseRoute(lapse?.from ?? back ?? '#/'), { replace: true });
    useUiStore.getState().notify(welcomeNote(account, lapse, registered));
  }

  return {
    ...INITIAL,

    async start() {
      if (starting || get().phase !== 'checking') return;
      starting = true;
      const notice = takeNotice();
      try {
        const [options, me] = await Promise.allSettled([accountApi.options(), accountApi.me()]);
        const known = options.status === 'fulfilled' ? options.value : null;
        if (known) set({ options: known });
        if (me.status === 'fulfilled') {
          adopt(me.value);
          if (notice) useUiStore.getState().notify(notice);
          return;
        }
        if (notice) set({ notice });
        // nobody signed in; or the server could not say, when a later 401 still leads to the login
        const out = unauthorized(me.reason) || known?.mode === 'accounts';
        set({ phase: out ? 'out' : 'local' });
      } finally {
        starting = false;
      }
    },

    async loadOptions() {
      try {
        set({ options: await accountApi.options() });
      } catch {
        // the login offers signing in alone until the options come
      }
    },

    async signIn(username, password) {
      welcome(await accountApi.login({ username, password }), false);
    },

    async sendEmailCode(email) {
      return accountApi.emailCode({ email });
    },

    async signInEmail(email, code) {
      welcome(await accountApi.emailLogin({ email, code }), false);
    },

    async register(username, password, invite) {
      welcome(await accountApi.register({ username, password, ...(invite ? { invite } : {}) }), true);
    },

    async signOut() {
      try {
        await accountApi.logout();
      } catch (error) {
        // a session already gone is as good as ended
        if (!unauthorized(error)) throw error;
      }
      forgetPlayerData();
      setDataOwner(null);
      leaveNotice('已退出。');
      page.restart(LOGIN);
    },

    lapsed() {
      const { phase, account } = get();
      if (phase === 'out') return;
      const from = here();
      if (phase === 'in') {
        set({
          phase: 'out',
          account: null,
          lapse: { from: isLogin(from) ? '#/' : from, ...(account ? { username: account.user.username, email: account.user.email } : {}) },
        });
      } else {
        set({ phase: 'out', account: null, back: isLogin(from) ? null : from });
      }
      if (!get().options) void get().loadOptions();
    },

    hold(address) {
      if (get().back || get().lapse || isLogin(address)) return;
      set({ back: address });
    },

    async refresh() {
      try {
        set({ account: await accountApi.me() });
      } catch (error) {
        if (unauthorized(error)) get().lapsed();
        throw error;
      }
    },

    async changePassword(oldPassword, newPassword) {
      try {
        await accountApi.changePassword({ oldPassword, newPassword });
      } catch (error) {
        if (unauthorized(error)) get().lapsed();
        throw error;
      }
    },

    noteTurn(turn) {
      const lapse = get().lapse;
      if (lapse) set({ lapse: { ...lapse, turn } });
    },
  };
});

whenSignedOut(() => useAccount.getState().lapsed());
