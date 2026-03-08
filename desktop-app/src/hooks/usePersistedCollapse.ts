import { useState, useCallback } from "react";

/**
 * A boolean state hook that persists its value to sessionStorage under `cfg_<key>`.
 * Returns `[value, setValue]` like useState, but the setter also writes to sessionStorage.
 * State resets when the app is closed/reopened but survives navigation within a session.
 */
export function usePersistedCollapse(
  key: string,
  defaultValue: boolean,
): [boolean, (v: boolean) => void] {
  const [value, _setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(`cfg_${key}`);
      return stored !== null ? stored === "true" : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (v: boolean) => {
      _setValue(v);
      try {
        sessionStorage.setItem(`cfg_${key}`, String(v));
      } catch {
        /* noop */
      }
    },
    [key],
  );

  return [value, setValue];
}
