import { useSyncExternalStore } from 'react';
import { getServerSessionState, getSessionState, subscribeSession } from './session';

export function useSession() {
    return useSyncExternalStore(subscribeSession, getSessionState, getServerSessionState);
}
