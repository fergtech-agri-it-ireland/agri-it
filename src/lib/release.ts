/**
 * Release version and credit (14 Oct 2026, as on Gauntlet): a small line at the foot of every
 * screen. The version comes from package.json; the build stamps in the commit and the day built.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

const def = <T,>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };

export const APP_VERSION = def(() => __APP_VERSION__, '0.0.0');
export const BUILD_SHA = def(() => __BUILD_SHA__, '');
export const BUILD_DATE = def(() => __BUILD_DATE__, '');
export const COMPANY = 'FergTech';

/** "Agri-It v0.2.0 · © 2026 FergTech · Built by FergTech" */
export function releaseLine(version = APP_VERSION, builtOn = BUILD_DATE): string {
  const year = /^\d{4}/.test(builtOn) ? builtOn.slice(0, 4) : String(new Date().getFullYear());
  return `Agri-It v${version} · © ${year} ${COMPANY} · Built by ${COMPANY}`;
}

/** For the tooltip and the backup file: which build this is. */
export function buildLabel(sha = BUILD_SHA, builtOn = BUILD_DATE): string {
  return [sha && `build ${sha}`, builtOn && `built ${builtOn}`].filter(Boolean).join(', ');
}
