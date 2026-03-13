import React, { useState, useRef, useEffect } from "react";
import { useAssistantContext } from "../../context/AssistantContext";
import { useWizard } from "../../hooks/useWizard";
import { ASSISTANT_SAMPLE_QUESTIONS } from "../../constants";
import { AssistantMessage } from "./AssistantMessage";
import { AssistantSetup } from "./AssistantSetup";
import { AssistantSettingsModal } from "./AssistantSettingsModal";

export const AssistantPanel: React.FC = () => {
  const {
    isConfigured,
    isOpen,
    toggle,
    close,
    messages,
    loading,
    error,
    sendMessage,
    switchProvider,
    clearError,
    provider,
  } = useAssistantContext();

  const { screen } = useWizard();
  const sampleQuestions = ASSISTANT_SAMPLE_QUESTIONS[screen] || [];
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && isConfigured) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, isConfigured]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        className={`assistant-toggle ${isOpen ? "assistant-toggle-hidden" : ""}`}
        onClick={toggle}
        title="AI Assistant"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Panel */}
      <div className={`assistant-panel ${isOpen ? "assistant-panel-open" : ""}`}>
        {/* Header */}
        <div className="assistant-header">
          <div className="assistant-header-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>AI Assistant</span>
          </div>
          <div className="assistant-header-actions">
            {isConfigured && (
              <>
                {provider === "github-models" && (
                  <button
                    className="assistant-header-btn"
                    onClick={() => setShowSettings(true)}
                    title="Model Settings"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v6m0 6v6m-9-9h6m6 0h6" />
                      <path d="M12 1v6m0 6v6" transform="rotate(45 12 12)" />
                    </svg>
                  </button>
                )}
                <button
                  className="assistant-header-btn"
                  onClick={switchProvider}
                  title="Switch Provider"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16,17 21,12 16,7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </>
            )}
            <button className="assistant-header-btn" onClick={close} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="assistant-body">
          {!isConfigured ? (
            <AssistantSetup />
          ) : (
            <>
              <div className="assistant-messages">
                {messages.length === 0 && (
                  <div className="assistant-empty">
                    <p>Ask me anything about this step, Databricks, or your deployment.</p>
                  </div>
                )}
                {sampleQuestions.length > 0 && (
                  <div className="assistant-sample-questions">
                    {sampleQuestions.map((question, i) => (
                      <button
                        key={`${screen}-${i}`}
                        className="assistant-sample-question"
                        onClick={() => sendMessage(question)}
                        disabled={loading}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                )}
                {messages.map((msg, i) => (
                  <AssistantMessage key={i} message={msg} />
                ))}
                {loading && (
                  <div className="assistant-message assistant-message-bot">
                    <div className="assistant-message-bubble assistant-typing">
                      <span className="assistant-dot" />
                      <span className="assistant-dot" />
                      <span className="assistant-dot" />
                    </div>
                  </div>
                )}
                {error && (
                  <div className="assistant-error">
                    <span>{error}</span>
                    <button onClick={clearError}>Dismiss</button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <form className="assistant-input-form" onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="text"
                  className="assistant-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question..."
                  disabled={loading}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="assistant-send-btn"
                  disabled={!input.trim() || loading}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22,2 15,22 11,13 2,9" />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && <AssistantSettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
};
