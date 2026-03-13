export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AssistantSettings {
  active_provider: string;
  configured: boolean;
  github_model?: string;
  cached_models?: [string, string][];
  models_cache_timestamp?: number;
  chat_history?: ChatMessage[];
  has_github_key: boolean;
  has_openai_key: boolean;
  has_claude_key: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
}
