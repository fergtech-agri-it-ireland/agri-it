/** True in the browser-only demo build (`npm run build:demo`): sample farm, changes kept in this browser. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
/**
 * True in the phone-only build (`npm run build:phone`): the farmer's own farm, starting
 * empty, with every record and photo kept on this phone. No account and no server.
 */
export const IS_LOCAL = import.meta.env.VITE_LOCAL === '1';
/** Either one-file build that keeps its data in this browser instead of Supabase. */
export const IN_BROWSER = IS_DEMO || IS_LOCAL;
/**
 * True when the app runs inside another page's frame (e.g. a shared preview link).
 * Such frames block downloads, printing and the photo reader's files, so screens
 * offer copy and paste instead.
 */
export const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();
