// The account's requests (docs/play-contracts.md, 四; docs/accounts-and-isolation-plan.md, 第二段的实际做法):
// the public options and sign-in, and, once signed in, the account, its usage, the password and signing
// out. Their 401s are theirs to read (a wrong password, nobody signed in): the client does not take them
// for a lapsed session.
import type { Account, AccountOptions, EmailCodeRequest, EmailCodeSent, EmailLoginRequest, LoginRequest, PasswordChange, RegisterRequest, UsageReport } from '../contracts';
import { json } from './client';

export const accountApi = {
  options: (signal?: AbortSignal) => json<AccountOptions>('GET', '/account/options', undefined, signal),
  /** who is signed in; 401 when nobody is (accounts mode), the local player in local mode */
  me: (signal?: AbortSignal) => json<Account>('GET', '/account', undefined, signal),
  usage: (signal?: AbortSignal) => json<UsageReport>('GET', '/account/usage', undefined, signal),
  login: (body: LoginRequest) => json<Account>('POST', '/account/login', body),
  emailCode: (body: EmailCodeRequest) => json<EmailCodeSent>('POST', '/account/email/code', body),
  emailLogin: (body: EmailLoginRequest) => json<Account>('POST', '/account/email/login', body),
  register: (body: RegisterRequest) => json<Account>('POST', '/account/register', body),
  changePassword: (body: PasswordChange) => json<void>('POST', '/account/password', body),
  logout: () => json<void>('POST', '/account/logout'),
};
