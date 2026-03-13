import { createContext, useContext, useCallback, ReactNode } from "react";
import { useAssistant } from "../hooks";
import type { UseAssistantReturn } from "../hooks";
import { useWizard } from "../hooks/useWizard";

// ---------------------------------------------------------------------------
// Context value interface
// ---------------------------------------------------------------------------
export interface AssistantContextValue extends Omit<UseAssistantReturn, 'sendMessage'> {
  sendMessage: (text: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export const AssistantContext = createContext<AssistantContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AssistantProvider({ children }: { children: ReactNode }) {
  const assistant = useAssistant();
  const { screen, selectedCloud, selectedTemplate } = useWizard();

  // Wrap sendMessage to inject current wizard state automatically
  // Extract sendMessage from assistant to avoid recreating the callback on every render
  const { sendMessage: assistantSendMessage } = assistant;
  
  const sendMessage = useCallback(async (text: string) => {
    await assistantSendMessage(text, screen, selectedCloud, selectedTemplate?.name ?? null);
  }, [assistantSendMessage, screen, selectedCloud, selectedTemplate]);

  const value: AssistantContextValue = {
    ...assistant,
    sendMessage,
  };

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAssistantContext(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistantContext must be used within AssistantProvider");
  return ctx;
}
