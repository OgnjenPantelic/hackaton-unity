import { renderHook, act } from "@testing-library/react";
import { useSsoPolling } from "../../hooks/useSsoPolling";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSsoPolling", () => {
  it("calls checkFn at the specified interval", async () => {
    const checkFn = vi.fn().mockResolvedValue(false);
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 10,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // One run immediately, then one per second at 1s, 2s, 3s
    expect(checkFn).toHaveBeenCalledTimes(4);
  });

  it("stops polling and calls onSuccess when checkFn returns true", async () => {
    const checkFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 10,
      });
    });

    // First run is immediate (returns false), second at 1s returns true
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(checkFn).toHaveBeenCalledTimes(2);

    // Further ticks: polling stopped, no more checkFn
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(checkFn).toHaveBeenCalledTimes(2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("stops polling and calls onTimeout after maxAttempts failed calls", async () => {
    const checkFn = vi.fn().mockRejectedValue(new Error("fail"));
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 3,
      });
    });

    // Advance through all 3 attempts
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }

    expect(checkFn).toHaveBeenCalledTimes(3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT call onTimeout for non-final failed attempts", async () => {
    const checkFn = vi.fn().mockRejectedValue(new Error("fail"));
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 5,
      });
    });

    // One run immediately, then at 1s and 2s = 3 runs (under maxAttempts 5)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(checkFn).toHaveBeenCalledTimes(3);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("clearSsoPolling stops an active poll", async () => {
    const checkFn = vi.fn().mockResolvedValue(false);
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 10,
      });
    });

    // One run immediately, one at 1s
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(checkFn).toHaveBeenCalledTimes(2);

    // Clear polling
    act(() => {
      result.current.clearSsoPolling();
    });

    // More ticks — should not call checkFn again
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(checkFn).toHaveBeenCalledTimes(2);
  });

  it("does not call callbacks if unmounted via cleanup", async () => {
    const checkFn = vi.fn().mockResolvedValue(true);
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    // Cleanup before starting (sets isMountedRef to false)
    act(() => {
      result.current.cleanup();
    });

    act(() => {
      result.current.startPolling(checkFn, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 5,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // checkFn runs but onSuccess should NOT fire because isMountedRef is false
    expect(checkFn).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("clears previous poll when startPolling is called again", async () => {
    const checkFn1 = vi.fn().mockResolvedValue(false);
    const checkFn2 = vi.fn().mockResolvedValue(false);
    const onSuccess = vi.fn();
    const onTimeout = vi.fn();

    const { result } = renderHook(() => useSsoPolling());

    // Start first poll
    act(() => {
      result.current.startPolling(checkFn1, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 10,
      });
    });

    // Immediately start second poll (should cancel first)
    act(() => {
      result.current.startPolling(checkFn2, onSuccess, onTimeout, {
        interval: 1000,
        maxAttempts: 10,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // First poll ran once (immediate) before being replaced; second poll runs immediately + at 1s, 2s
    expect(checkFn1).toHaveBeenCalledTimes(1);
    expect(checkFn2).toHaveBeenCalledTimes(3);
  });
});
