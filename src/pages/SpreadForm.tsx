import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import type { FertiliserSpread, FertiliserSpreadField } from '../lib/types';
import { fmtDay, fmtKg, fmtNum, todayISO, uuid } from '../lib/format';
import { isClosed, ruleSourceLine, seasonOn, zoneFor } from '../lib/spreading';
import { isExempt, lastSpreadOn } from '../lib/forecast/fertiliser';
import { Button, Card, Chips, DateChips, Empty, LinkButton, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';

type RateUnit = 'bags' | 'kg';
const BAG_KG = 50;

/**
 * Spread fertiliser on one field or several at once. The total comes off the stock. Nothing
 * here suggests a rate: the farmer enters what went on.
 */
export default function SpreadForm() {
  const [params] = useSearchParams();
  const b = useFarmData();
  const d = useDerived(b);
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const today = todayISO();
  const products = b.fertilisers.filter((p) => !p.archived);
  const fields = b.fields.filter((f) => !f.archived);
  const lastUsed = [...b.spreads].sort((x, y) => y.spread_on.localeCompare(x.spread_on))[0]?.product_id;
  const [productId, setProductId] = useState<string | null>(params.get('product') ?? (products.some((p) => p.id === lastUsed) ? lastUsed! : products[0]?.id ?? null));
  const [date, setDate] = useState(today);
  const [picked, setPicked] = useState<string[]>(() => (params.get('field') ? [params.get('field')!] : []));
  const [mode, setMode] = useState<'per_acre' | 'total'>('per_acre');
  const [unit, setUnit] = useState<RateUnit>('bags');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const product = products.find((p) => p.id === productId) ?? null;
  const stock = d.fertiliser.products.find((x) => x.product.id === productId) ?? null;
  const chosen = fields.filter((f) => picked.includes(f.id));
  const acres = chosen.reduce((s, f) => s + Number(f.acres ?? 0), 0);
  const noAcres = chosen.filter((f) => !f.acres);
  const amt = Number(amount);
  const perUnitKg = unit === 'bags' ? BAG_KG : 1;

  // kg on each field
  const split = useMemo(() => {
    if (!chosen.length || !(amt > 0)) return null;
    if (mode === 'per_acre') {
      if (noAcres.length) return null;
      return chosen.map((f) => ({ field: f, acres: Number(f.acres), kg: Math.round(amt * perUnitKg * Number(f.acres) * 10) / 10 }));
    }
    const total = amt * perUnitKg;
    if (chosen.length === 1) return [{ field: chosen[0], acres: chosen[0].acres ? Number(chosen[0].acres) : null, kg: total }];
    if (noAcres.length) return null;
    return chosen.map((f) => ({ field: f, acres: Number(f.acres), kg: Math.round((total * Number(f.acres)) / acres * 10) / 10 }));
  }, [chosen, amt, mode, perUnitKg, noAcres.length, acres]);
  const totalKg = split ? Math.round(split.reduce((s, x) => s + x.kg, 0) * 10) / 10 : 0;
  const kgPerAcre = split && acres > 0 ? Math.round((totalKg / acres) * 10) / 10 : null;

  const zone = zoneFor(b.farm.jurisdiction, b.farm.county);
  const closed = zone && product && !isExempt(product) && isClosed(zone, date) ? seasonOn(zone, date) : null;
  const after = stock ? stock.stockKg - totalKg : null;

  function toggle(id: string) {
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  }
  const grazing = fields.filter((f) => f.use === 'grazing').map((f) => f.id);

  async function submit() {
    if (!split || !product) return;
    const spread: FertiliserSpread = { id: uuid(), farm_id: farmId!, product_id: product.id, spread_on: date, kg_per_acre: kgPerAcre, total_kg: totalKg, notes: note.trim() || null };
    const rows: FertiliserSpreadField[] = split.map((x) => ({ id: uuid(), farm_id: farmId!, spread_id: spread.id, field_id: x.field.id, acres: x.acres, kg: x.kg }));
    const ok = await save([
      { kind: 'insert', table: 'fertiliser_spreads', row: { ...spread } },
      ...rows.map((r) => ({ kind: 'insert' as const, table: 'fertiliser_spread_fields', row: { ...r } }))
    ], {
      label: `${fmtKg(totalKg)} of ${product.name} on ${chosen.length === 1 ? chosen[0].name : `${chosen.length} fields`}`,
      patch: (x) => ({ ...x, spreads: [...x.spreads, { ...spread, created_at: new Date().toISOString() }], spreadFields: [...x.spreadFields, ...rows] }),
      undo: [{ kind: 'delete', table: 'fertiliser_spreads', match: { id: spread.id } }]
    });
    if (ok) nav('/fertiliser', { replace: true });
  }

  if (!products.length || !fields.length) {
    return (
      <Screen title="Spread fertiliser" back>
        <Empty title={!fields.length ? 'Add your fields first' : 'Add a fertiliser first'}
          body={!fields.length ? 'Spreading is recorded field by field, so Agri-It can flag each field when it is due again.' : 'Add the fertiliser you have in the shed, with how much is there, so spreading comes off the stock.'}
          action={<LinkButton to={!fields.length ? '/farm/fields' : '/fertiliser/new'}>{!fields.length ? 'Add fields' : 'Add a fertiliser'}</LinkButton>} />
      </Screen>
    );
  }

  return (
    <Screen title="Spread fertiliser" back>
      <Card className="space-y-5">
        <Chips label="What did you spread?" columns={2} value={productId} onChange={setProductId}
          options={products.map((p) => {
            const s = d.fertiliser.products.find((x) => x.product.id === p.id);
            return { value: p.id, label: p.name, sub: s && s.basis !== 'nothing' ? `${fmtKg(s.stockKg)} in stock` : 'No stock recorded' };
          })} />
        <DateChips label="When?" value={date} onChange={setDate} />
        {closed && (
          <p role="alert" className="rounded-xl bg-warn-bg p-3 text-[0.9375rem] font-semibold text-warn">
            {fmtDay(date)} is in the closed period for {closed.rule.zone === 'NI' ? 'Northern Ireland' : `Zone ${closed.rule.zone}`} ({fmtDay(closed.closedFrom)} to {fmtDay(closed.closedTo)}). Check the date.
            <span className="mt-1 block text-sm font-normal">{ruleSourceLine(closed.rule)}</span>
          </p>
        )}
      </Card>
      <Card className="space-y-3">
        <fieldset>
          <legend className="label">Which fields?</legend>
          <div className="mb-2 flex flex-wrap gap-2">
            {grazing.length > 1 && <button type="button" onClick={() => setPicked([...new Set([...picked, ...grazing])])} className="min-h-[2.75rem] rounded-full px-3 font-bold text-accent">All grazing fields</button>}
            {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="min-h-[2.75rem] rounded-full px-3 font-bold text-muted">Clear</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fields.map((f) => {
              const on = picked.includes(f.id);
              const last = lastSpreadOn(b, f.id, today);
              const due = d.fertiliser.due.some((x) => x.field.id === f.id && x.kind !== 'cut_passed');
              return (
                <button key={f.id} type="button" aria-pressed={on} onClick={() => toggle(f.id)}
                  className={`min-h-[3.5rem] rounded-xl border px-3 py-2 text-left ${on ? 'border-field bg-field text-white' : 'border-line bg-card'}`}>
                  <span className="flex items-center gap-1.5 text-[0.9375rem] font-bold leading-tight">{on && <Check className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden />}{f.name}</span>
                  <span className={`block text-sm ${on ? 'text-white/85' : 'text-muted'}`}>{[f.acres ? `${fmtNum(Number(f.acres))} ac` : 'no acres', due ? 'due' : last ? `last ${fmtDay(last.on)}` : null].filter(Boolean).join(' · ')}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {chosen.length > 0 && <p className="text-sm font-semibold">{chosen.length} field{chosen.length > 1 ? 's' : ''}{acres ? `, ${fmtNum(Math.round(acres * 10) / 10)} acres` : ''}</p>}
      </Card>
      <Card className="space-y-4">
        <Chips label="How much?" columns={2} value={mode} onChange={setMode} options={[{ value: 'per_acre', label: 'Per acre' }, { value: 'total', label: 'In total' }]} />
        <Chips columns={2} value={unit} onChange={setUnit} options={[{ value: 'bags', label: '50 kg bags' }, { value: 'kg', label: 'kg' }]} />
        <NumberInput label={mode === 'per_acre' ? `${unit === 'bags' ? 'Bags' : 'kg'} per acre` : `${unit === 'bags' ? 'Bags' : 'kg'} in total`} value={amount} onChange={setAmount} unit={unit === 'bags' ? 'bags' : 'kg'} />
        {noAcres.length > 0 && (mode === 'per_acre' || chosen.length > 1) && (
          <p className="rounded-xl bg-pasture p-3 text-[0.9375rem]">
            {noAcres.map((f) => f.name).join(', ')} {noAcres.length > 1 ? 'have' : 'has'} no acres. Add them in Fields{mode === 'per_acre' ? ', or enter the total for one field at a time' : ' so the total can be split by acres'}.
          </p>
        )}
        {split && (
          <div className="rounded-xl bg-field-light p-3 text-[0.9375rem]">
            <p className="font-bold">{fmtKg(totalKg)} of {product?.name}{kgPerAcre ? `, ${fmtNum(kgPerAcre)} kg an acre` : ''}</p>
            {stock && stock.basis !== 'nothing' && after !== null && <p>In stock {fmtKg(stock.stockKg)}, {after >= 0 ? `${fmtKg(after)} left after this` : `${fmtKg(-after)} more than recorded in stock`}</p>}
          </div>
        )}
        {after !== null && after < 0 && stock?.basis !== 'nothing' && <p role="alert" className="rounded-xl bg-warn-bg p-3 text-[0.9375rem] font-semibold text-warn">That's more than the stock Agri-It has. Save it anyway if it went on, then do a stock check.</p>}
        {after !== null && after >= 0 && product?.low_stock_kg !== null && product && after <= Number(product.low_stock_kg) && <p className="rounded-xl bg-hivis/30 p-3 text-[0.9375rem] font-semibold">This takes {product.name} to your low level ({fmtKg(Number(product.low_stock_kg))}).</p>}
        <TextInput label="Note (optional)" value={note} onChange={setNote} voice />
      </Card>
      <SaveBar><Button block disabled={!split || !product || totalKg <= 0} onClick={submit}>Save spreading</Button></SaveBar>
    </Screen>
  );
}
