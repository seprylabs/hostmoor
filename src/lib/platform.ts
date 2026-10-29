/** Operating system the app runs on; in the browser (npm run dev) the browser's system */
export type Platform = "macos" | "windows" | "linux";

const ua = navigator.userAgent;
export const platform: Platform = /Mac/.test(ua) ? "macos" : /Windows/.test(ua) ? "windows" : "linux";
