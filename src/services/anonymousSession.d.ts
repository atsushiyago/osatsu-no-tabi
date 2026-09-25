import type { Auth, User, UserCredential } from 'firebase/auth';

export function getOrCreateAnonymousUser(
  auth: Auth,
  signIn: (auth: Auth) => Promise<UserCredential>
): Promise<User>;
