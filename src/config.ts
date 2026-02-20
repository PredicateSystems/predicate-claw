export interface ProviderConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  backoffInitialMs: number;
  failClosed: boolean;
}

export const defaultProviderConfig: ProviderConfig = {
  baseUrl: "http://127.0.0.1:8787",
  timeoutMs: 300,
  maxRetries: 0,
  backoffInitialMs: 100,
  failClosed: true,
};
