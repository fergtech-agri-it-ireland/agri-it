import { SPECIES_LABEL } from '../lib/types';
import { stageTable } from '../lib/lifeStages';
import { Card, Screen, SectionTitle } from '../components/ui';

const when = (m: number) => (m === 0 ? 'from birth' : m < 24 ? `from ${m} month${m === 1 ? '' : 's'}` : `from ${m / 12} years`);

/** The ages Agri-It uses to turn a date born into calf, weanling, heifer and the rest. */
export default function AnimalStages() {
  const rows = stageTable();
  return (
    <Screen title="Life stages" back="/animals">
      <p className="px-1 text-[0.9375rem]">An animal&apos;s stage is worked out from its date born, so it moves up on its own as it grows. Nothing has to be updated by hand.</p>
      {rows.map((r) => (
        <section key={r.who}>
          <SectionTitle>{r.who}</SectionTitle>
          <Card as="div">
            <table className="w-full text-left text-[0.9375rem]" data-stages={r.species}>
              <thead className="sr-only"><tr><th>Stage</th><th>Age</th></tr></thead>
              <tbody>{r.steps.map((s) => <tr key={s.label} className="border-t border-line first:border-0"><td className="py-1.5 font-semibold">{s.label}</td><td className="py-1.5 text-right text-muted">{when(s.from)}</td></tr>)}</tbody>
            </table>
          </Card>
        </section>
      ))}
      <Card as="div"><p className="text-[0.9375rem] text-muted">These ages are Agri-It&apos;s defaults from common Irish farm practice. They are not official definitions, and farms wean and breed at different ages. For one animal that is different, open it and pick its life stage by hand. {SPECIES_LABEL.other} animals have one stage. Changing the ages for the whole farm is not built yet.</p></Card>
    </Screen>
  );
}
