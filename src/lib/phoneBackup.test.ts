import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { backupCompleteness, backupDue, backupLine, isZip, packBackup, unpackBackup } from './phoneBackup';

const json = JSON.stringify({
  app: 'agri-it', kind: 'phone-backup', v: 1, saved_at: '2026-10-14T10:00:00Z',
  db: { farms: [{ id: 'f1', name: 'Test' }], documents: [{ id: 'd1', storage_path: 'f1/docket one.jpg' }, { id: 'd2', storage_path: 'f1/inv?#2.pdf' }] }
});
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]);
const pdf = strToU8('%PDF-1.4 tiny');

describe('full phone backup (review G01, gate G4)', () => {
  it('round-trips records and every photo, byte for byte, whatever the path', () => {
    const zip = packBackup(json, [
      { path: 'f1/docket one.jpg', type: 'image/jpeg', data: jpg },
      { path: 'f1/inv?#2.pdf', type: 'application/pdf', data: pdf }
    ]);
    expect(isZip(zip)).toBe(true);
    const un = unpackBackup(zip);
    expect(un.full).toBe(true);
    expect(JSON.parse(un.json).db.farms[0].name).toBe('Test');
    expect(un.files.map((f) => f.path)).toEqual(['f1/docket one.jpg', 'f1/inv?#2.pdf']);
    expect(Array.from(un.files[0].data)).toEqual(Array.from(jpg));
    expect(un.files[1].type).toBe('application/pdf');
  });

  it('still reads an older records-only backup', () => {
    const un = unpackBackup(strToU8(`﻿${json}`));
    expect(un.full).toBe(false);
    expect(un.files).toEqual([]);
    expect(JSON.parse(un.json).app).toBe('agri-it');
  });

  it('refuses a damaged zip instead of restoring half a farm', () => {
    const zip = packBackup(json, [{ path: 'f1/docket one.jpg', type: 'image/jpeg', data: jpg }]);
    expect(() => unpackBackup(zip.slice(0, zip.length - 30))).toThrow(/damaged/);
  });

  it('refuses a zip that is not an Agri-It backup', async () => {
    const { zipSync } = await import('fflate');
    expect(() => unpackBackup(zipSync({ 'notes.txt': strToU8('hello') }))).toThrow(/not an Agri-It backup/);
  });

  it('says which photos the records point at but the backup lacks', () => {
    const db = JSON.parse(json).db;
    expect(backupCompleteness(db, ['f1/docket one.jpg'])).toEqual({ photos: 1, missing: ['f1/inv?#2.pdf'] });
    expect(backupLine(12, 1, 1)).toBe('12 records and 1 photo. 1 photo is no longer on this phone and could not be included.');
    expect(backupLine(1, 0, 0)).toBe('1 record and 0 photos.');
  });

  it('asks for a backup when there has never been one, or after 30 days', () => {
    expect(backupDue(5, null, '2026-10-14')).toBe(false);
    expect(backupDue(12, null, '2026-10-14')).toBe(true);
    expect(backupDue(12, '2026-09-20', '2026-10-14')).toBe(false);
    expect(backupDue(12, '2026-09-13', '2026-10-14')).toBe(true);
  });
});
