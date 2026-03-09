import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatMessage, AssistantSettings, ModelOption, AppScreen } from "../types";
import { ASSISTANT, SCREEN_CONTEXT } from "../constants";

export interface UseAssistantReturn {
  // State
  isConfigured: boolean;
  isOpen: boolean;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  availableModels: ModelOption[];
  modelsLoading: boolean;
  provider: string | null;
  settings: AssistantSettings | null;

  // Actions
  toggle: () => void;
  open: () => void;
  close: () => void;
  sendMessage: (text: string, screen: AppScreen, selectedCloud: string, selectedTemplateName: string | null) => Promise<void>;
  saveToken: (provider: string, apiKey: string) => Promise<void>;
  reconnect: (provider: string) => Promise<void>;
  switchProvider: () => Promise<void>;
  deleteProviderKey: (provider: string) => Promise<void>;
  deleteAllKeys: () => Promise<void>;
  clearError: () => void;
  updateModel: (model: string) => Promise<void>;
}

export function useAssistant(): UseAssistantReturn {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);

  // Keep a ref to messages that always has the current value
  const messagesRef = useRef<ChatMessage[]>(messages);
  
  // Keep ref in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await invoke<AssistantSettings>("assistant_get_settings");
        setSettings(loadedSettings);
        setIsConfigured(loadedSettings.configured);
        setProvider(loadedSettings.active_provider);
        setSelectedModel(loadedSettings.github_model || null);
        
        // Load persisted chat history
        if (loadedSettings.chat_history) {
          setMessages(loadedSettings.chat_history);
        }
      } catch {
        // Settings load failed — assistant stays unconfigured
      }
    };
    loadSettings();
  }, []);

  // Load available models when configured with GitHub
  useEffect(() => {
    if (isConfigured && provider === "github-models") {
      setModelsLoading(true);
      setAvailableModels([]); // Clear while loading
      invoke<[string, string][]>("assistant_get_available_models")
        .then(models => {
          setAvailableModels(models.map(([id, name]) => ({ id, name })));
          setModelsLoading(false);
        })
        .catch((err) => {
          console.error("[useAssistant] Failed to load models:", err);
          // Set a default fallback so user can still use the assistant
          setAvailableModels([
            { id: "openai/gpt-4o-mini", name: "GPT-4o mini (default)" }
          ]);
          setModelsLoading(false);
        });
    }
  }, [isConfigured, provider]);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(async (
    text: string,
    screen: AppScreen,
    selectedCloud: string,
    selectedTemplateName: string | null,
  ) => {
    if (!text.trim()) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    setError(null);

    try {
      const screenContext = SCREEN_CONTEXT[screen] || "The user is using the Databricks Deployer application.";

      // Build sanitized state metadata (no secrets)
      const stateParts: string[] = [];
      if (selectedCloud) stateParts.push(`Cloud provider: ${selectedCloud}`);
      if (selectedTemplateName) stateParts.push(`Template: ${selectedTemplateName}`);
      const stateMetadata = stateParts.join(". ");

      // Send last N messages as history (read from ref to get current value)
      const historySlice = messagesRef.current.slice(-ASSISTANT.MAX_HISTORY_MESSAGES);

      const reply = await invoke<string>("assistant_chat", {
        message: text,
        screen,
        screenContext,
        stateMetadata,
        history: historySlice,
      });

      const assistantMessage: ChatMessage = { role: "assistant", content: reply };
      setMessages(prev => {
        const newMessages = [...prev, assistantMessage];
        // Save history to disk (limit to MAX_HISTORY_MESSAGES)
        const historyToSave = newMessages.slice(-ASSISTANT.MAX_HISTORY_MESSAGES);
        invoke("assistant_save_history", { messages: historyToSave }).catch((err) => {
          console.error("[useAssistant] Failed to save history:", err);
        });
        return newMessages;
      });
    } catch (e: unknown) {
      console.error("[useAssistant] sendMessage error:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveToken = useCallback(async (provider: string, apiKey: string) => {
    setLoading(true);
    setError(null);

    try {
      await invoke("assistant_save_token", { provider, apiKey });
      const updatedSettings = await invoke<AssistantSettings>("assistant_get_settings");
      setSettings(updatedSettings);
      setIsConfigured(updatedSettings.configured);
      setProvider(updatedSettings.active_provider);
      setLoading(false);
    } catch (e: unknown) {
      console.error("[useAssistant] Failed to save token:", e);
      setError(String(e));
      setLoading(false);
    }
  }, []);

  const reconnect = useCallback(async (provider: string) => {
    setLoading(true);
    setError(null);

    try {
      await invoke("assistant_reconnect", { provider });
      const updatedSettings = await invoke<AssistantSettings>("assistant_get_settings");
      setSettings(updatedSettings);
      setIsConfigured(updatedSettings.configured);
      setProvider(updatedSettings.active_provider);
      setLoading(false);
    } catch (e: unknown) {
      console.error("[useAssistant] Failed to reconnect:", e);
      setError(String(e));
      setLoading(false);
    }
  }, []);

  const switchProvider = useCallback(async () => {
    try {
      await invoke("assistant_switch_provider");
      const updatedSettings = await invoke<AssistantSettings>("assistant_get_settings");
      setSettings(updatedSettings);
      setIsConfigured(updatedSettings.configured);
      setMessages([]);
      setModelsLoading(false);
    } catch (e: unknown) {
      setError(`Failed to switch provider: ${String(e)}`);
    }
  }, []);

  const deleteProviderKey = useCallback(async (providerToDelete: string) => {
    try {
      await invoke("assistant_delete_provider_key", { provider: providerToDelete });
      const updatedSettings = await invoke<AssistantSettings>("assistant_get_settings");
      setSettings(updatedSettings);
      if (provider === providerToDelete) {
        setIsConfigured(false);
        setMessages([]);
        setProvider(null);
        setSelectedModel(null);
        setAvailableModels([]);
        setModelsLoading(false);
      }
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [provider]);

  const deleteAllKeys = useCallback(async () => {
    try {
      await invoke("assistant_delete_all_keys");
      const updatedSettings = await invoke<AssistantSettings>("assistant_get_settings");
      setSettings(updatedSettings);
      setIsConfigured(false);
      setMessages([]);
      setProvider(null);
      setSelectedModel(null);
      setAvailableModels([]);
      setModelsLoading(false);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, []);

  const updateModel = useCallback(async (model: string) => {
    try {
      await invoke("assistant_update_model", { model });
      setSelectedModel(model);
    } catch (e: unknown) {
      setError(String(e));
    }
  }, []);

  return {
    isConfigured,
    isOpen,
    messages,
    loading,
    error,
    selectedModel,
    availableModels,
    modelsLoading,
    provider,
    settings,
    toggle,
    open,
    close,
    sendMessage,
    saveToken,
    reconnect,
    switchProvider,
    deleteProviderKey,
    deleteAllKeys,
    clearError,
    updateModel,
  };
}
