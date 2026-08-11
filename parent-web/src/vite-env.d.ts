/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PCA_API_BASE_URL: string;
  readonly VITE_PCA_DEMO_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
