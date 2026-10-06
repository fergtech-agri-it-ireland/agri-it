/**
 * After-save summary (after Strava's post-activity screen, with the clear next step
 * a design critique found missing there). A form builds this and navigates to
 * /record/done with it as router state.
 */
import type { NavigateFunction } from 'react-router-dom';
import type { Op } from './offline/outbox';
import type { RecordType } from './types';
import type { SaveResult } from './data/farm';

export interface SavedRow {
  label: string;
  before?: string | null;
  after: string;
  sub?: string;
}

export interface SavedSummary {
  title: string; // "Delivery saved"
  subtitle: string; // "Dairy nut 16%, 8 t from Tirlán"
  compare?: { label: string; before: number; after: number; unit: string };
  rows: SavedRow[];
  note?: string;
  undo?: Op[];
  undoLabel?: string;
  /** Lets the farmer attach a docket/invoice after saving, when none was attached. */
  photo?: { table: 'feed_transactions' | 'income' | 'costs'; id: string; recordType: RecordType };
  again: { label: string; to: string };
  queued?: boolean;
}

export function showSaved(nav: NavigateFunction, result: SaveResult, summary: SavedSummary) {
  if (!result) return;
  nav('/record/done', { replace: true, state: { ...summary, queued: result === 'queued' } satisfies SavedSummary });
}
