import { describe, expect, it } from 'vitest';
import { APP_VERSION, buildLabel, releaseLine } from './release';
import pkg from '../../package.json';

describe('release line', () => {
  it('shows the package version, the year and FergTech', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(releaseLine('0.2.0', '2026-10-16')).toBe('Agri-It v0.2.0 · © 2026 FergTech · Built by FergTech');
    expect(releaseLine('0.2.0', '2026-10-16')).not.toMatch(/\u2014/);
  });
  it('names the build when known, and leaves it out when not', () => {
    expect(buildLabel('3f2a1c9', '2026-10-16')).toBe('build 3f2a1c9, built 2026-10-16');
    expect(buildLabel('', '')).toBe('');
  });
});
