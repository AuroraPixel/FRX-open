// The account in sample-data mode (?fixture=<name>). A set without account files stands for local mode:
// no login, the built-in local player, as nearly every set and screenshot has it. A set with
// account-options.json stands for accounts mode:
//
//   account-options.json   GET /account/options
//   account.json           the account signed in from the start (GET /account); without it nobody is, and
//                          every sign-in and registration is refused, to show the login's errors
//   account-usage.json     GET /account/usage
// Changing the password and signing out are answered as done.
import type { Account, AccountOptions, UsageReport } from '../contracts';

type Load = (name: string) => Promise<unknown>;

/** The built-in local player (docs/accounts-and-isolation-plan.md, 两种运行方式). */
export const LOCAL_ACCOUNT: Account = {
  mode: 'local',
  user: { id: '00000000-0000-0000-0000-000000000001', username: 'local', role: 'admin' },
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costReported: true, turns: 0 },
  limits: {},
};

const LOCAL_OPTIONS: AccountOptions = { mode: 'local', registration: 'closed' };

function answer(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function refuse(status: number, code: string, message: string): Response {
  return answer({ error: { code, message } }, status);
}

function usageOf(account: Account): UsageReport {
  return {
    since: '2026-11-11T10:00:00Z',
    until: '2026-11-12T10:00:00Z',
    total: account.usage,
    byPurpose: [],
    stored: { saves: 0, imageBytes: 0 },
    limits: account.limits,
  };
}

/** The answer to a request under /account, or undefined for any other path. */
export async function answerAccount(method: string, path: string, load: Load): Promise<Response | undefined> {
  if (path !== '/account' && !path.startsWith('/account/')) return undefined;
  const options = (await load('account-options')) as AccountOptions | undefined;
  const account = options ? ((await load('account')) as Account | undefined) : LOCAL_ACCOUNT;
  const asked = `${method} ${path}`;
  if (asked === 'GET /account/options') return answer(options ?? LOCAL_OPTIONS);
  if (!options && method !== 'GET') return refuse(403, 'forbidden', '本机模式没有账号。');
  switch (asked) {
    case 'GET /account':
      return account ? answer(account) : refuse(401, 'unauthorized', '请先登录');
    case 'GET /account/usage': {
      if (!account) return refuse(401, 'unauthorized', '请先登录');
      return answer(((await load('account-usage')) as UsageReport | undefined) ?? usageOf(account));
    }
    case 'POST /account/login':
      return account ? answer(account) : refuse(401, 'unauthorized', '用户名或密码不对');
    case 'POST /account/email/code':
      return options?.emailLogin ? answer({ retryAfter: 60, expiresIn: 600 }) : refuse(403, 'forbidden', '当前未开放邮箱登录');
    case 'POST /account/email/login':
      if (!options?.emailLogin) return refuse(403, 'forbidden', '当前未开放邮箱登录');
      return account ? answer(account) : refuse(401, 'unauthorized', '验证码不对或已过期，请重新获取');
    case 'POST /account/register':
      return refuse(422, 'invalid_input', '邀请码无效、已过期或已经用过');
    case 'POST /account/password':
    case 'POST /account/logout':
      return account ? new Response(null, { status: 204 }) : refuse(401, 'unauthorized', '请先登录');
    default:
      return refuse(404, 'not_found', '样例数据里没有这一项。');
  }
}
