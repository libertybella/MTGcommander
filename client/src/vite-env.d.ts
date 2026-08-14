/// <reference types="vite/client" />

declare global {
  interface Window {
    mtgCommander?: {
      isElectron: true;
      appName: string;
      httpFetch?: (
        url: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string },
      ) => Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
        text: () => Promise<string>;
      }>;
      hostStart?: (snapshot: unknown) => Promise<{
        port: number;
        roomCode: string;
        addresses: string[];
      }>;
      hostStop?: () => Promise<void>;
    };
  }
}

export {};
