/** True in the browser-only demo build (`npm run build:demo`): sample farm, changes kept in this browser. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
/**
 * True in the phone-only build (`npm run build:phone`): the farmer's own farm, starting
 * empty, with every record and photo kept on this phone. No account and no server.
 */
export const IS_LOCAL = import.meta.env.VITE_LOCAL === '1';
/**
 * True in the online build (`npm run build:online`): signs in to the Supabase project and
 * keeps records on the server, published at /agri-it/online/ next to the phone app.
 * It shares a web address with the phone app, so its browser storage uses its own names.
 */
export const IS_ONLINE = import.meta.env.VITE_ONLINE === '1';
/**
 * Prefix for this build's browser storage keys and databases. The phone app (and the demo)
 * keep 'agri-it'; the online build uses 'agri-it-online' so the two never read or clear
 * each other's data on the shared address.
 */
export const NS = IS_ONLINE ? 'agri-it-online' : 'agri-it';
/** A localStorage or sessionStorage key for this build, e.g. key('cache'). */
export const key = (name: string) => `${NS}:${name}`;
/** Either one-file build that keeps its data in this browser instead of Supabase. */
export const IN_BROWSER = IS_DEMO || IS_LOCAL;
/**
 * True when the app runs inside another page's frame (e.g. a shared preview link).
 * Such frames block downloads, printing and the photo reader's files, so screens
 * offer copy and paste instead.
 */
export const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** A full link to a screen in this app (for invitations and sign-up emails), e.g. appLink('/join/abc'). */
export function appLink(path = '/'): string {
  const hash = IN_BROWSER || IS_ONLINE;
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return path === '/' ? base : `${base}${hash ? '#' : ''}${path.replace(/^\//, hash ? '/' : '')}`;
}
