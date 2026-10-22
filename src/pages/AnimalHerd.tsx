import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { PAGE_SIZE, applyFilter, isFiltered, summarise, viewAll } from '../lib/animalQuery';
import { ageText } from '../lib/lifeStages';
import { formatTag } from '../lib/animalId';
import { SPECIES_LABEL, ANIMAL_STATUS_LABEL } from '../lib/types';
import { fmtDate, fmtNum, todayISO } from '../lib/format';
import { AnimalFilterBar, filterFromParams, filterToParams } from '../components/AnimalFilterBar';
import { Button, Card, Empty, LinkButton, List, Row, Screen } from '../components/ui';

/**
 * Every animal, found by tag, kind, life stage, group, sex or breed. Built for thousands: the list
 * shows 50 at a time and the counts above it are for everything that matches.
 */
export default function AnimalHerd() {
  const b = useFarmData();
  const today = todayISO();
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(params), [params]);
  const [pages, setPages] = useState(1);
  const views = useMemo(() => viewAll(b, today), [b, today]);
  const hits = useMemo(() => applyFilter(views, filter).sort((x, y) => x.a.tag_number.localeCompare(y.a.tag_number)), [views, filter]);
  const shown = hits.slice(0, pages * PAGE_SIZE);
  const mix = useMemo(() => summarise(hits, filter.status === 'left'), [hits, filter.status]);
  const query = filterToParams(filter).toString();

  return (
    <Screen title="Find and manage" back="/animals" sub={`${fmtNum(views.length)} animal${views.length === 1 ? '' : 's'} recorded`}
      right={<LinkButton to="/animals/add" variant="secondary" className="mr-1">Add</LinkButton>}>
      <AnimalFilterBar views={views} groups={b.groups} filter={filter} onChange={(f) => { setPages(1); setParams(filterToParams(f), { replace: true }); }} />
      <p data-testid="match-count" className="px-1 text-[0.9375rem] font-bold">
        {hits.length === 0 ? 'No animals match' : `${fmtNum(hits.length)} ${hits.length === 1 ? 'animal' : 'animals'}`}
        {mix.length > 0 && hits.length > 0 && <span className="font-normal text-muted">: {mix.slice(0, 3).map((k) => `${fmtNum(k.count)} ${k.stages.length === 1 ? (k.count === 1 ? k.stages[0].label : k.stages[0].plural).toLowerCase() : SPECIES_LABEL[k.species].toLowerCase()}`).join(', ')}</span>}
      </p>
      {views.length === 0 ? (
        <Empty title="No animals yet" body="Add them one at a time, or paste a list of tags to add hundreds at once." action={<LinkButton to="/animals/add">Add animals</LinkButton>} />
      ) : hits.length === 0 ? (
        <Empty title="Nothing matches" body={isFiltered(filter) || filter.status !== 'on' ? 'Try fewer filters, or check the status above.' : undefined} />
      ) : (
        <>
          <List>
            {shown.map((v) => (
              <Row key={v.a.id} to={`/animals/${v.a.id}`} data-animal={v.a.id}
                title={<span data-animal={v.a.tag_number}>{formatTag(v.a.tag_number)}</span>}
                sub={[v.stage.label, ageText(v.stage.ageMonths), v.group?.name, v.a.breed, v.a.status !== 'on_farm' ? `${ANIMAL_STATUS_LABEL[v.a.status]}${v.a.left_on ? ` ${fmtDate(v.a.left_on)}` : ''}` : null].filter(Boolean).join(', ')}
                right={<ChevronRight className="h-5 w-5 text-muted" aria-hidden />} />
            ))}
          </List>
          {shown.length < hits.length && (
            <Button variant="secondary" block onClick={() => setPages(pages + 1)}>Show {fmtNum(Math.min(PAGE_SIZE, hits.length - shown.length))} more (showing {fmtNum(shown.length)} of {fmtNum(hits.length)})</Button>
          )}
          <Card className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-[0.9375rem]">Change all {fmtNum(hits.length)} at once: sold, died, a new group or breed.</p>
            <Link to={`/animals/update${query ? `?${query}` : ''}`} className="inline-flex min-h-tap items-center rounded-full bg-field px-4 font-bold text-white">Update these</Link>
          </Card>
        </>
      )}
    </Screen>
  );
}
