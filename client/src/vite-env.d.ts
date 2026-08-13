/// <reference types="vite/client" />

declare global {
  interface Window {
    mtgCommander?: {
      isElectron: true;
      appName: string;
    };
  }
}

export {};
