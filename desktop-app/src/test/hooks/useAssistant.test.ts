import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAssistant } from "../../hooks/useAssistant";
import { AssistantSettings } from "../../types";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("useAssistant", () => {
  // ---------------------------------------------------------------------------
  // Initial State
  // ---------------------------------------------------------------------------
  describe("initial state", () => {
    it("starts unconfigured with empty messages", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      });

      const { result } = renderHook(() => useAssistant());

      // Wait for the mount effect (settings load) to settle
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("assistant_get_settings");
      });

      expect(result.current.isConfigured).toBe(false);
      expect(result.current.isOpen).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("loads settings on mount", async () => {
      const settings: AssistantSettings = {
        active_provider: "github-models",
        configured: true,
        github_model: "openai/gpt-4o-mini",
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      };
      mockInvoke.mockResolvedValueOnce(settings);
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_get_settings");
      expect(result.current.provider).toBe("github-models");
      expect(result.current.selectedModel).toBe("openai/gpt-4o-mini");
      expect(result.current.settings).toEqual(settings);
    });

    it("loads chat history from settings", async () => {
      const settings: AssistantSettings = {
        active_provider: "github-models",
        configured: true,
        chat_history: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      };
      mockInvoke.mockResolvedValueOnce(settings);
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });

      expect(result.current.messages).toEqual(settings.chat_history);
    });
  });

  // ---------------------------------------------------------------------------
  // saveToken
  // ---------------------------------------------------------------------------
  describe("saveToken", () => {
    it("saves token and updates state on success", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockResolvedValueOnce(undefined); // Save token success
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Settings reload after save
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)

      const { result } = renderHook(() => useAssistant());

      await act(async () => {
        await result.current.saveToken("github-models", "github_pat_test123");
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_save_token", {
        provider: "github-models",
        apiKey: "github_pat_test123",
      });
      expect(result.current.isConfigured).toBe(true);
      expect(result.current.provider).toBe("github-models");
      expect(result.current.loading).toBe(false);
    });

    it("sets error state on failure", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockRejectedValueOnce("Invalid API key");

      const { result } = renderHook(() => useAssistant());

      await act(async () => {
        await result.current.saveToken("github-models", "bad_key");
      });

      expect(result.current.error).toBe("Invalid API key");
      expect(result.current.isConfigured).toBe(false);
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------------
  describe("sendMessage", () => {
    it("sends message and updates state on success", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce("This is the assistant's reply"); // Chat response
      mockInvoke.mockResolvedValueOnce(undefined); // Save history

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.sendMessage("What is Databricks?", "welcome", "aws", null);
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_chat", {
        message: "What is Databricks?",
        screen: "welcome",
        screenContext: expect.stringContaining("welcome"),
        stateMetadata: "Cloud provider: aws",
        history: [],
      });

      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]).toEqual({
        role: "user",
        content: "What is Databricks?",
      });
      expect(result.current.messages[1]).toEqual({
        role: "assistant",
        content: "This is the assistant's reply",
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();

      // Verify history was saved
      expect(mockInvoke).toHaveBeenCalledWith("assistant_save_history", {
        messages: result.current.messages,
      });
    });

    it("includes history in request", async () => {
      const settings: AssistantSettings = {
        active_provider: "github-models",
        configured: true,
        chat_history: [
          { role: "user", content: "First question" },
          { role: "assistant", content: "First answer" },
        ],
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      };
      mockInvoke.mockResolvedValueOnce(settings); // Initial settings load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce("Second answer"); // Chat response
      mockInvoke.mockResolvedValueOnce(undefined); // Save history

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });

      await act(async () => {
        await result.current.sendMessage("Second question", "welcome", "", null);
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_chat", {
        message: "Second question",
        screen: "welcome",
        screenContext: expect.any(String),
        stateMetadata: "",
        history: [
          { role: "user", content: "First question" },
          { role: "assistant", content: "First answer" },
        ],
      });
    });

    it("sets error state on failure", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockRejectedValueOnce("Rate limit reached");

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.sendMessage("Test", "welcome", "", null);
      });

      expect(result.current.error).toBe("Rate limit reached");
      expect(result.current.messages).toHaveLength(1); // Only user message added
      expect(result.current.loading).toBe(false);
    });

    it("does not send empty messages", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      });
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.sendMessage("   ", "welcome", "", null);
      });

      // Should not call assistant_chat for empty/whitespace message
      expect(mockInvoke).toHaveBeenCalledTimes(2); // Settings load + models load
      expect(result.current.messages).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // switchProvider
  // ---------------------------------------------------------------------------
  describe("switchProvider", () => {
    it("resets state and clears messages", async () => {
      const settings: AssistantSettings = {
        active_provider: "github-models",
        configured: true,
        chat_history: [{ role: "user", content: "Old message" }],
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      };
      mockInvoke.mockResolvedValueOnce(settings); // Initial load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce(undefined); // Switch provider success
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Settings reload after switch

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
      });

      await act(async () => {
        await result.current.switchProvider();
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_switch_provider");
      expect(result.current.isConfigured).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.modelsLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      });
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockRejectedValueOnce("Failed to switch");

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.switchProvider();
      });

      expect(result.current.error).toBe("Failed to switch provider: Failed to switch");
    });
  });

  // ---------------------------------------------------------------------------
  // deleteProviderKey
  // ---------------------------------------------------------------------------
  describe("deleteProviderKey", () => {
    it("resets state when deleting active provider", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce(undefined); // Delete success
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      }); // Settings reload after delete

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.deleteProviderKey("github-models");
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_delete_provider_key", {
        provider: "github-models",
      });
      expect(result.current.isConfigured).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.provider).toBeNull();
      expect(result.current.selectedModel).toBeNull();
    });

    it("does not reset state when deleting non-active provider", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: true,
        has_claude_key: false,
      }); // Initial load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce(undefined); // Delete success
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Settings reload after delete

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.deleteProviderKey("openai");
      });

      // Should not reset state since active provider is github-models
      expect(result.current.isConfigured).toBe(true);
      expect(result.current.provider).toBe("github-models");
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAllKeys
  // ---------------------------------------------------------------------------
  describe("deleteAllKeys", () => {
    it("resets all state", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce(undefined); // Delete all success
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      }); // Settings reload after delete all

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.deleteAllKeys();
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_delete_all_keys");
      expect(result.current.isConfigured).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.provider).toBeNull();
      expect(result.current.selectedModel).toBeNull();
      expect(result.current.availableModels).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Model loading (GitHub only)
  // ---------------------------------------------------------------------------
  describe("model loading", () => {
    it("loads models when configured with GitHub", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockResolvedValueOnce([
        ["openai/gpt-4o-mini", "GPT-4o mini (OpenAI)"],
        ["meta-llama/llama-3", "Llama 3 (Meta)"],
      ]); // Models list

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.availableModels).toHaveLength(2);
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_get_available_models");
      expect(result.current.availableModels).toEqual([
        { id: "openai/gpt-4o-mini", name: "GPT-4o mini (OpenAI)" },
        { id: "meta-llama/llama-3", name: "Llama 3 (Meta)" },
      ]);
      expect(result.current.modelsLoading).toBe(false);
    });

    it("uses fallback model on load error", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial settings load
      mockInvoke.mockRejectedValueOnce("Failed to fetch models");

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.availableModels).toHaveLength(1);
      });

      expect(result.current.availableModels[0].id).toBe("openai/gpt-4o-mini");
      expect(result.current.modelsLoading).toBe(false);
    });

    it("does not load models for non-GitHub providers", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "openai",
        configured: true,
        has_github_key: false,
        has_openai_key: true,
        has_claude_key: false,
      });

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      // Should only call assistant_get_settings, not assistant_get_available_models
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(result.current.availableModels).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // updateModel
  // ---------------------------------------------------------------------------
  describe("updateModel", () => {
    it("updates selected model", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: true,
        has_github_key: true,
        has_openai_key: false,
        has_claude_key: false,
      }); // Initial load
      mockInvoke.mockResolvedValueOnce([]); // Models list (loaded automatically for GitHub)
      mockInvoke.mockResolvedValueOnce(undefined); // Update model success

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(result.current.isConfigured).toBe(true);
      });

      await act(async () => {
        await result.current.updateModel("meta-llama/llama-3");
      });

      expect(mockInvoke).toHaveBeenCalledWith("assistant_update_model", {
        model: "meta-llama/llama-3",
      });
      expect(result.current.selectedModel).toBe("meta-llama/llama-3");
    });
  });

  // ---------------------------------------------------------------------------
  // UI actions
  // ---------------------------------------------------------------------------
  describe("UI actions", () => {
    it("toggles panel open/close", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      });

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("assistant_get_settings");
      });

      expect(result.current.isOpen).toBe(false);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it("opens and closes panel", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      });

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("assistant_get_settings");
      });

      act(() => {
        result.current.open();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.close();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it("clears error", async () => {
      mockInvoke.mockResolvedValueOnce({
        active_provider: "github-models",
        configured: false,
        has_github_key: false,
        has_openai_key: false,
        has_claude_key: false,
      });
      mockInvoke.mockRejectedValueOnce("Test error");

      const { result } = renderHook(() => useAssistant());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("assistant_get_settings");
      });

      await act(async () => {
        await result.current.saveToken("github-models", "bad_key");
      });

      expect(result.current.error).toBe("Test error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
