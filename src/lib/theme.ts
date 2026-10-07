/**
 * Screen modes. Dawn mode is a dark screen for early milking and late checks;
 * "auto" turns it on before 8am and from 8pm. Sunlight mode (max contrast) is
 * separate and still applies in daylight. Both are per-device preferences.
 */
import { useEffect, useState } from 'react';

export type DawnPref = 'off' | 'on' | 'auto';
const DAWN_KEY = 'agri-it:dawn';
const SUN_KEY = 'agri-it:sunlight';
const EVENT = 'agri-it:theme';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* preference just won't persist */ }
}

export function getDawnPref(): DawnPref {
  const v = read(DAWN_KEY);
  return v === 'on' || v === 'auto' ? v : 'off';
}
export function getSunlight(): boolean {
  return read(SUN_KEY) === '1';
}

export function isDawnActive(pref: DawnPref = getDawnPref(), now = new Date()): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  const h = now.getHours();
  return h < 8 || h >= 20;
}

export function applyTheme() {
  const dawn = isDawnActive();
  const root = document.documentElement;
  root.classList.toggle('dawn', dawn);
  root.classList.toggle('sunlight', getSunlight() && !dawn);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dawn ? '#0B110E' : '#F1F4F2');
  window.dispatchEvent(new Event(EVENT));
}

export function setDawnPref(p: DawnPref) {
  write(DAWN_KEY, p);
  applyTheme();
}
export function setSunlight(on: boolean) {
  write(SUN_KEY, on ? '1' : '0');
  applyTheme();
}

/** Apply now, then re-check every few minutes and when the app comes back to the front (for auto mode). */
export function startThemeClock() {
  applyTheme();
  window.setInterval(applyTheme, 5 * 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && applyTheme());
}

export function useTheme() {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const dawnPref = getDawnPref();
  const dawn = isDawnActive(dawnPref);
  return {
    dawnPref,
    dawn,
    sunlight: getSunlight(),
    setDawnPref,
    setSunlight,
    /** Header shortcut: flip what's showing now, as an explicit choice. */
    toggleDawn: () => setDawnPref(dawn ? 'off' : 'on')
  };
}
