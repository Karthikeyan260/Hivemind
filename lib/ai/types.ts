export type ProviderName = "gemini" | "nvidia" | "groq" | "openrouter" | "github";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type GenerateOptions = {
  system?: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export interface AIProvider {
  name: ProviderName;
  model: string;
  isConfigured(): boolean;
  generate(messages: ChatMessage[], opts?: GenerateOptions): Promise<string>;
}

export type GenerateResult = {
  text: string;
  provider: ProviderName;
  model: string;
  latencyMs: number;
};
