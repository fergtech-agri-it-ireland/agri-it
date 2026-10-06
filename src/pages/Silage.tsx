import { ChevronRight } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { estimateStore } from '../lib/forecast/forage';
import { fmtDate, fmtNum } from '../lib/format';
import { Empty, LinkButton, List, Row, Screen } from '../components/ui';

export default function Silage() {
  const b = useFarmData();
  return (
    <Screen title="Silage and bales" back="/farm" right={<LinkButton to="/farm/silage/new" variant="hivis">Add</LinkButton>}>
      <p className="px-1 text-muted">Measure the pit once it's closed: measurements always beat acreage estimates.</p>
      {b.silage.length === 0 ? <Empty title="Nothing recorded" body="Add your pit or bales to see if you're covered for the winter." action={<LinkButton to="/farm/silage/new" variant="hivis">Add silage</LinkButton>} /> : (
        <List>
          {b.silage.map((s) => {
            const e = estimateStore(s);
            return (
              <Row key={s.id} to={`/farm/silage/${s.id}/edit`} title={s.name}
                sub={<>{e.tonnes !== null ? `${fmtNum(Math.round(e.tonnes))} t fresh. ` : ''}{e.missing ?? e.explanation}{e.basis === 'planning_estimate' && ' '}<br />Measured {fmtDate(s.measured_on)}{s.dm_percent ? `, ${s.dm_percent}% DM` : ''}{s.dmd_percent ? `, ${s.dmd_percent}% DMD` : ''}</>}
                right={<ChevronRight className="h-5 w-5 text-muted" />} />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
