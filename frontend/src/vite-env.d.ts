/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "apple" only in the squadreader.com/replay build (npm run build:apple). */
  readonly VITE_THEME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
