import type { AuthCredential, AuthProvider, User } from 'firebase/auth';

export type GoogleSyncState = 'anonymous' | 'linked' | 'other' | 'unavailable';

export function getGoogleSyncState(user: User | null): GoogleSyncState;

export function syncGoogleAccount(options: {
  user: User;
  provider: AuthProvider;
  link: (user: User, provider: AuthProvider) => Promise<User>;
  getCredentialFromError: (error: unknown) => AuthCredential | null;
  signInWithCredential: (credential: AuthCredential) => Promise<User>;
  onUserSwitched?: (user: User) => void;
  countTrackedBills: (uid: string) => Promise<number>;
  confirmSwitch: (trackedBillCount: number) => boolean;
  onStage?: (stage: string) => void;
  handleExistingAccount?: (input: {
    credential: AuthCredential | null;
    previousUid: string;
  }) => Promise<{
    status: 'cancelled' | 'switched' | 'popup-fallback' | 'merged';
    previousUid: string;
    uid: string;
  }>;
}): Promise<{
  status: 'linked' | 'cancelled' | 'switched' | 'popup-fallback' | 'merged';
  previousUid: string;
  uid: string;
}>;

export function getGoogleSyncErrorMessage(error: { code?: string } | null | undefined, language?: 'ja' | 'en'): string | null;
