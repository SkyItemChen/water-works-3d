/**
 * The one place the app version comes from.
 *
 * vite.config.ts reads package.json and inlines `__APP_VERSION__` at build time,
 * so there is exactly one source of truth: bump package.json, nothing else.
 * The fallback keeps unit tests and any non-Vite context working.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
