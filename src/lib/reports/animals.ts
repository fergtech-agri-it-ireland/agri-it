/**
 * Animal report: one row per animal that has a tag number in Agri-It, with the dates that matter:
 * tag number, type, stage, group, sex, breed, date born, status (on the farm, sold, died, moved off) and the
 * date it left. Above the list, a few counts for the year: born, sold, died, moved off, and how
 * many are on the farm at the end.
 *
 * Which animals: those on the farm at any time in the year. An animal that left before the year
 * began is not listed. An animal with no date born is listed (it may be older than the records).
 * Head counts on the group pages are not used here: this report is the tagged animals only, and
 * says so when the two differ.
 */
import type { Animal, FarmBundle, ISODate } from '../types';
import { ANIMAL_STATUS_LABEL, SPECIES_LABEL } from '../types';
import { speciesOf, stageOf } from '../lifeStages';
import { purposeFor } from '../animalQuery';
import { formatTag } from '../animalId';
import { DISCLAIMER, type CellValue, type ReportDoc, type ReportRow } from './doc';
import { RETENTION } from './rules';
import { reportPeriod } from './common';
import { metaFor } from './profit';

export interface AnimalLine {
  id: string;
  tag: string;
  kind: string;
  stage: string;
  group: string;
  sex: string;
  breed: string;
  bornOn: ISODate | null;
  status: string;
  leftOn: ISODate | null;
}

export interface AnimalFigures {
  lines: AnimalLine[];
  onFarmAtEnd: number;
  bornInYear: number;
  soldInYear: number;
  diedInYear: number;
  movedOffInYear: number;
  /** Left the farm but no date given: cannot be placed in a year */
  leftNoDate: number;
  /** Heads in the groups, to say when the tagged animals are only some of them */
  groupHeads: number;
  complete: boolean;
  reasons: string[];
  notes: string[];
}

const SEX = { female: 'Female', male: 'Male' } as const;

export function animalFigures(b: FarmBundle, today: ISODate, offset = 0): AnimalFigures {
  const p = reportPeriod(b.farm, today, offset);
  const start = p.fy.start; const end = p.asAt;
  const groups = new Map(b.groups.map((g) => [g.id, g]));
  const groupName = new Map(b.groups.map((g) => [g.id, g.name]));
  const all: Animal[] = b.animals ?? [];
  const present = all.filter((a) => (!a.born_on || a.born_on <= end) && (!a.left_on || a.left_on >= start));
  const lines: AnimalLine[] = present
    .map((a) => ({
      id: a.id, tag: formatTag(a.tag_number), kind: SPECIES_LABEL[speciesOf(a)],
      stage: stageOf(a, a.left_on && a.left_on < end ? a.left_on : end, purposeFor(b, (a.animal_group_id && groups.get(a.animal_group_id)) || null)).label,
      group: (a.animal_group_id && groupName.get(a.animal_group_id)) || '',
      sex: a.sex ? SEX[a.sex] : '', breed: a.breed ?? '', bornOn: a.born_on, status: ANIMAL_STATUS_LABEL[a.status], leftOn: a.left_on
    }))
    .sort((x, y) => x.tag.localeCompare(y.tag));
  const inYear = (d: ISODate | null) => !!d && d >= start && d <= end;
  const leftIn = (s: Animal['status']) => present.filter((a) => a.status === s && inYear(a.left_on)).length;
  const onFarmAtEnd = present.filter((a) => (a.left_on ? a.left_on > end : a.status === 'on_farm')).length;
  const leftNoDate = present.filter((a) => a.status !== 'on_farm' && !a.left_on).length;
  const groupHeads = b.groups.filter((g) => !g.archived).reduce((s, g) => s + Number(g.head_count ?? 0), 0);
  const reasons: string[] = [];
  const notes: string[] = [];
  if (leftNoDate) reasons.push(`${leftNoDate} animal${leftNoDate > 1 ? 's' : ''} marked sold, died or moved off with no date`);
  if (all.length && groupHeads > onFarmAtEnd && offset === 0) notes.push(`${onFarmAtEnd} of ${groupHeads} animals in your groups have a tag number here`);
  return {
    lines, onFarmAtEnd, bornInYear: present.filter((a) => inYear(a.born_on)).length,
    soldInYear: leftIn('sold'), diedInYear: leftIn('died'), movedOffInYear: leftIn('moved_off'), leftNoDate, groupHeads,
    complete: reasons.length === 0, reasons, notes
  };
}

export function animalsReport(b: FarmBundle, today: ISODate, opts: { offset?: number; now?: string } = {}): { doc: ReportDoc; figures: AnimalFigures } {
  const p = reportPeriod(b.farm, today, opts.offset ?? 0);
  const f = animalFigures(b, today, opts.offset ?? 0);
  const count = (label: string, n: number): ReportRow => ({ label, cells: [n] });
  const summary = {
    heading: 'This year',
    columns: [{ label: 'Animals', type: 'number' as const }],
    rows: [count('Born', f.bornInYear), count('Sold', f.soldInYear), count('Died', f.diedInYear), count('Moved off', f.movedOffInYear), { ...count('On the farm at the end', f.onFarmAtEnd), kind: 'total' as const }]
  };
  const cols: { label: string; type: 'text' | 'date' }[] = [
    { label: 'Type', type: 'text' }, { label: 'Stage', type: 'text' }, { label: 'Group', type: 'text' }, { label: 'Sex', type: 'text' }, { label: 'Breed', type: 'text' }, { label: 'Born', type: 'date' }, { label: 'Status', type: 'text' }, { label: 'Left', type: 'date' }
  ];
  const list = {
    heading: 'Animals',
    columns: cols,
    rows: f.lines.map((l): ReportRow => ({ label: l.tag, to: `/animals/${l.id}`, cells: [l.kind, l.stage, l.group, l.sex, l.breed, l.bornOn, l.status, l.leftOn] }))
  };
  const flat: CellValue[][] = f.lines.map((l) => [l.tag, l.kind, l.stage, l.group, l.sex, l.breed, l.bornOn, l.status, l.leftOn]);
  const doc: ReportDoc = {
    id: 'animals', title: 'Animals', subtitle: `${b.farm.name}, ${p.fy.label}${p.provisional ? ' (year to date)' : ''}`,
    meta: metaFor(b, p, null, opts.now ?? new Date().toISOString()),
    table: {
      columns: [{ label: 'Tag number', type: 'text' }, { label: 'Type', type: 'text' }, { label: 'Stage', type: 'text' }, { label: 'Group', type: 'text' }, { label: 'Sex', type: 'text' }, { label: 'Breed', type: 'text' }, { label: 'Born', type: 'date' }, { label: 'Status', type: 'text' }, { label: 'Left', type: 'date' }],
      rows: flat
    },
    basisNote: 'Animals with a tag number in Agri-It that were on the farm at some point in the year.',
    completeness: { complete: f.complete, reasons: f.reasons, notes: f.notes },
    sections: [summary, list],
    footnotes: [DISCLAIMER, 'Not the official herd register. Check dates against your official records.', RETENTION[b.farm.jurisdiction]]
  };
  return { doc, figures: f };
}
