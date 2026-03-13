import { useRef, useCallback } from "react";

/**
 * Hook for managing SSO polling intervals
 * Used by AWS SSO and Databricks OAuth login flows
 */
export function useSsoPolling() {
  const ssoPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const clearSsoPolling = useCallback(() => {
    if (ssoPollingRef.current) {
      clearInterval(ssoPollingRef.current);
      ssoPollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (
      checkFn: () => Promise<boolean>,
      onSuccess: () => void,
      onTimeout: () => void,
      options: {
        interval: number;
        maxAttempts: number;
        onError?: (error: unknown) => void;
        skipImmediate?: boolean;
      }
    ) => {
      clearSsoPolling();
      let attempts = 0;

      const runCheck = async () => {
        attempts++;
        try {
          const success = await checkFn();
          if (success) {
            clearSsoPolling();
            if (isMountedRef.current) onSuccess();
          }
        } catch (err) {
          if (options.onError) {
            clearSsoPolling();
            options.onError(err);
          } else if (attempts >= options.maxAttempts) {
            clearSsoPolling();
            if (isMountedRef.current) onTimeout();
          }
        }
      };

      // Run check immediately unless skipImmediate is true (e.g., for OAuth device flow that needs full interval wait)
      if (!options.skipImmediate) {
        runCheck();
      }
      ssoPollingRef.current = setInterval(runCheck, options.interval);
    },
    [clearSsoPolling]
  );

  const cleanup = useCallback(() => {
    isMountedRef.current = false;
    clearSsoPolling();
  }, [clearSsoPolling]);

  const setMounted = useCallback((mounted: boolean) => {
    isMountedRef.current = mounted;
  }, []);

  return {
    startPolling,
    clearSsoPolling,
    cleanup,
    setMounted,
    isMountedRef,
  };
}
