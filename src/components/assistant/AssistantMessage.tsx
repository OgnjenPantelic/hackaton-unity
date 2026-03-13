import React from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage } from "../../types";

interface AssistantMessageProps {
  message: ChatMessage;
}

interface CodeComponentProps {
  node?: unknown;
  className?: string;
  children?: React.ReactNode;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div className={`assistant-message ${isUser ? "assistant-message-user" : "assistant-message-bot"}`}>
      <div className="assistant-message-bubble">
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown
            components={{
              code: ({ node, className, children, ...props }: CodeComponentProps) => {
                const inline = !className;
                return inline ? 
                  <code className="assistant-inline-code" {...props}>{children}</code> :
                  <code className="assistant-code-block" {...props}>{children}</code>;
              },
              a: ({ node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" className="assistant-link" />
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
};
