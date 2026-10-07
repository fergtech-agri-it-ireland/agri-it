import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFarmCtx, useFarmData, useSave } from '../lib/data/farm';
import type { Crop } from '../lib/types';
import { eur, fmtNum, uuid } from '../lib/format';
import { COMMON_CROPS, currentHarvest } from '../lib/farmTypes';
import { Button, Chips, Empty, List, NumberInput, Row, Screen, Sheet, TextInput } from '../components/ui';

export default function Crops() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const [open, setOpen] = useState(false);
  const harvest = currentHarvest();
  const [name, setName] = useState('');
  const [variety, setVariety] = useState('');
  const [acres, setAcres] = useState('');
  const [year, setYear] = useState(String(harvest));
  const crops = b.crops.filter((c) => !c.archived).sort((a, c) => c.harvest_year - a.harvest_year || a.name.localeCompare(c.name));
  const years = [...new Set(crops.map((c) => c.harvest_year))];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const inputs = b.costs.filter((c) => (c.category === 'seed_sprays' || c.category === 'fertiliser') && c.occurred_on >= yearStart).reduce((s, c) => s + Number(c.amount_eur), 0);
  const sales = b.income.filter((i) => i.income_type === 'crop' && i.occurred_on >= yearStart).reduce((s, i) => s + Number(i.amount_eur), 0);

  async function add() {
    const row: Crop = { id: uuid(), farm_id: farmId!, name: name.trim(), variety: variety.trim() || null, acres: acres === '' ? null : Number(acres), harvest_year: Number(year), sown_on: null, archived: false };
    const ok = await save([{ kind: 'insert', table: 'crops', row: { ...row } }], {
      label: `${row.name} added`,
      patch: (x) => ({ ...x, crops: [...x.crops, row] }),
      undo: [{ kind: 'delete', table: 'crops', match: { id: row.id } }]
    });
    if (ok) { setOpen(false); setName(''); setVariety(''); setAcres(''); }
  }
  const archive = (c: Crop) => save([{ kind: 'update', table: 'crops', match: { id: c.id }, patch: { archived: true } }], {
    label: `${c.name} removed`,
    patch: (x) => ({ ...x, crops: x.crops.map((y) => (y.id === c.id ? { ...y, archived: true } : y)) }),
    undo: [{ kind: 'update', table: 'crops', match: { id: c.id }, patch: { archived: false } }]
  });

  return (
    <Screen title="Crops" back right={<Button onClick={() => setOpen(true)}>Add</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/record/cost?category=seed_sprays" className="rounded-[1.125rem] bg-card p-3.5 shadow-lift">
          <p className="numeral text-xl">{eur(inputs)}</p><p className="text-xs text-muted">Seed, spray and fertiliser this year</p>
        </Link>
        <Link to="/record/income?type=crop" className="rounded-[1.125rem] bg-card p-3.5 shadow-lift">
          <p className="numeral text-xl">{eur(sales)}</p><p className="text-xs text-muted">Grain and straw sold this year</p>
        </Link>
      </div>
      {crops.length === 0 ? (
        <Empty title="No crops yet" body="Add what you are growing and the acres, for this harvest or the next." action={<Button onClick={() => setOpen(true)}>Add a crop</Button>} />
      ) : years.map((y) => {
        const list = crops.filter((c) => c.harvest_year === y);
        const total = list.reduce((s, c) => s + Number(c.acres ?? 0), 0);
        return (
          <section key={y} className="space-y-1.5">
            <h2 className="eyebrow flex justify-between px-1 pt-2"><span>Harvest {y}</span><span>{fmtNum(total)} acres</span></h2>
            <List>
              {list.map((c) => (
                <Row key={c.id} title={c.name} sub={[c.variety, c.acres ? `${fmtNum(Number(c.acres))} acres` : 'Acres not set'].filter(Boolean).join(', ')}
                  right={<button onClick={() => archive(c)} className="min-h-[2.5rem] rounded-full px-3 text-sm font-bold text-muted hover:bg-pasture">Remove</button>} />
              ))}
            </List>
          </section>
        );
      })}

      <Sheet open={open} onClose={() => setOpen(false)} title="Add a crop">
        <div className="max-h-[70vh] space-y-4 overflow-auto pb-2">
          <Chips label="Crop" value={COMMON_CROPS.includes(name) ? name : null} onChange={setName} options={COMMON_CROPS.map((c) => ({ value: c, label: c }))} />
          <TextInput label="Or type it" value={name} onChange={setName} placeholder="e.g. Spring wheat" />
          <TextInput label="Variety (optional)" value={variety} onChange={setVariety} />
          <NumberInput label="Acres" value={acres} onChange={setAcres} unit="acres" />
          <Chips label="For harvest" value={year} onChange={setYear} options={[String(harvest - 1), String(harvest), String(harvest + 1)].map((y) => ({ value: y, label: y }))} />
          <Button block disabled={!name.trim()} onClick={add}>Add crop</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
