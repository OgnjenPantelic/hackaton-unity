import "@testing-library/jest-dom";
import { vi } from "vitest";

// Global mock for Tauri IPC -- every hook calls invoke()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
