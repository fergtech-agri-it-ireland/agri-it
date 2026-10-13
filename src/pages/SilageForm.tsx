import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFarmData, useFarmCtx, useSave } from '../lib/data/farm';
import { Check, ExternalLink } from 'lucide-react';
import { estimateStore, forecastForage } from '../lib/forecast/forage';
import { silageWithFedOut } from '../lib/data/derived';
import {
  autoDensity, bandLabel, canOfferTeagascDensity, CUT_LABEL, offerTeagascDensity, DM_SOURCES, DM_TESTS, dmSummary, TEAGASC_DENSITY_25DM, TEST_HOW, typicalDm,
  type DmTest, type SilageCut
} from '../lib/forecast/silageDm';
import type { SilageMethod, SilageStore } from '../lib/types';
import { fmtNum, todayISO, uuid } from '../lib/format';
import { Button, Card, Chips, DateChips, NumberInput, SaveBar, Screen, TextInput } from '../components/ui';

/** "Teagasc (S16)" as a link to the source, opened outside the app. */
function Source({ code }: { code: string }) {
  const src = DM_SOURCES[code];
  if (!src) return null;
  return (
    <a href={src.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent underline">
      {src.publisher}{src.published ? `, ${src.published.slice(0, 4)}` : ''}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

const n = (s: string) => (s === '' ? null : Number(s));
const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function SilageForm() {
  const { id } = useParams();
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const save = useSave();
  const nav = useNavigate();
  const ex = b.silage.find((x) => x.id === id);
  const [name, setName] = useState(ex?.name ?? '');
  const [method, setMethod] = useState<SilageMethod>(ex?.method ?? 'pit_dimensions');
  const [v, setV] = useState<Record<string, string>>({
    acreage: s(ex?.acreage), yield_t_per_acre: s(ex?.yield_t_per_acre), length_m: s(ex?.length_m), width_m: s(ex?.width_m),
    avg_height_m: s(ex?.avg_height_m), density_kg_m3: s(ex?.density_kg_m3), bale_count: s(ex?.bale_count), bale_weight_kg: s(ex?.bale_weight_kg),
    measured_tonnes: s(ex?.measured_tonnes), dm_percent: s(ex?.dm_percent), dmd_percent: s(ex?.dmd_percent), crude_protein_percent: s(ex?.crude_protein_percent),
    ph: s(ex?.ph), fed_out_tonnes: s(ex?.fed_out_tonnes ?? 0)
  });
  const [measuredOn, setMeasuredOn] = useState(ex?.measured_on ?? todayISO());
  const [cut, setCut] = useState<SilageCut | null>((ex?.cut as SilageCut | null | undefined) ?? null);
  const [dmTest, setDmTest] = useState<DmTest | null>((ex?.dm_test as DmTest | null | undefined) ?? null);
  const [testKind, setTestKind] = useState<'squeeze' | 'ball'>(DM_TESTS.find((t) => t.id === ex?.dm_test)?.test ?? 'squeeze');
  const [densityBasis, setDensityBasis] = useState<'own' | 'teagasc_25dm' | null>(ex?.density_basis ?? null);
  const jurisdiction = b.farm.jurisdiction;
  const set = (k: string) => (val: string) => {
    setV({ ...v, [k]: val });
    if (k === 'density_kg_m3') setDensityBasis(val === '' ? null : 'own');
  };
  const row = {
    id: ex?.id ?? uuid(), farm_id: farmId!, name: name || (method === 'bale_count' ? 'Bales' : 'Silage pit'), method, measured_on: measuredOn,
    ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, n(val)])), fed_out_tonnes: n(v.fed_out_tonnes) ?? 0, notes: ex?.notes ?? null,
    cut, dm_test: v.dm_percent === '' ? dmTest : null, density_basis: method === 'pit_dimensions' && v.density_kg_m3 !== '' ? densityBasis ?? 'own' : null
  } as SilageStore;
  const dm = dmSummary(row);
  const offerDensity = offerTeagascDensity(row);
  const densityDoubt = row.density_basis === 'teagasc_25dm' && !canOfferTeagascDensity(row);
  const est = estimateStore(row);
  const auto = autoDensity(row);
  /** What the whole winter looks like with this store as entered (nothing is saved). */
  const others = silageWithFedOut(b).filter((x) => x.id !== row.id);
  const winter = forecastForage({ farm: b.farm, stores: [...others, row], groups: b.groups, benchmarks: b.benchmarks, evidence: b.evidence, today: todayISO() });
  const winterBefore = forecastForage({ farm: b.farm, stores: others, groups: b.groups, benchmarks: b.benchmarks, evidence: b.evidence, today: todayISO() });

  async function submit() {
    const ok = await save([ex ? { kind: 'update', table: 'silage_stores', match: { id: row.id }, patch: row as unknown as Record<string, unknown> } : { kind: 'insert', table: 'silage_stores', row: row as unknown as Record<string, unknown> }], {
      label: 'Silage saved',
      patch: (x) => ({ ...x, silage: ex ? x.silage.map((y) => (y.id === row.id ? row : y)) : [...x.silage, row] })
    });
    if (ok) nav('/farm/silage', { replace: true });
  }
  async function remove() {
    const ok = await save([{ kind: 'delete', table: 'silage_stores', match: { id: row.id } }], { label: 'Removed', patch: (x) => ({ ...x, silage: x.silage.filter((y) => y.id !== row.id) }), undo: [{ kind: 'insert', table: 'silage_stores', row: ex as unknown as Record<string, unknown> }] });
    if (ok) nav('/farm/silage', { replace: true });
  }

  return (
    <Screen title={ex ? 'Edit silage' : 'Add silage'} back="/farm/silage">
      <Card className="space-y-5">
        <TextInput label="Name" value={name} onChange={setName} placeholder="e.g. Main pit" />
        <Chips label="How do you know how much?" columns={2} value={method} onChange={setMethod} options={[
          { value: 'pit_dimensions', label: 'Measured pit', sub: 'Length × width × height' },
          { value: 'bale_count', label: 'Counted bales' },
          { value: 'measured_tonnes', label: 'Weighed', sub: 'Tonnes known' },
          { value: 'acreage', label: 'Acres cut', sub: 'Planning estimate only' }
        ]} />
        {method === 'pit_dimensions' && (
          <div className="grid grid-cols-3 gap-2">
            <NumberInput label="Length" value={v.length_m} onChange={set('length_m')} unit="m" />
            <NumberInput label="Width" value={v.width_m} onChange={set('width_m')} unit="m" />
            <NumberInput label="Avg height" value={v.avg_height_m} onChange={set('avg_height_m')} unit="m" />
          </div>
        )}
        {method === 'pit_dimensions' && <NumberInput label="Density" value={v.density_kg_m3} onChange={set('density_kg_m3')} unit="kg/m³"
          hint={row.density_basis === 'teagasc_25dm' ? <>Teagasc's figure for pit silage of about 25% dry matter (<Source code="S16" />). Your winter plan says so.</> : auto ? 'Leave it blank and Agri-It works it out from your dry matter (below). Type your own if your advisor or lab gave you one.' : 'From your silage analysis or advisor, or leave blank and add the dry matter below.'} />}
        {auto && (
          <div className="rounded-xl bg-pasture p-3" data-testid="auto-density">
            <p className="font-bold">Worked out for you: {auto.basis === 'lab' ? `${auto.kgM3} kg/m³` : `${auto.kgM3} to ${auto.highKgM3} kg/m³`}</p>
            <p className="text-[0.95rem]">From {auto.from}, using the published conversion table ({auto.sources.map((c, i) => <span key={c}>{i > 0 && ', '}<Source code={c} /></span>)}).{auto.basis === 'yard_test' ? ' Your winter plan counts the lighter figure, so it never counts silage you may not have.' : ''}</p>
          </div>
        )}
        {offerDensity && (
          <div className="space-y-2 rounded-xl bg-pasture p-3">
            <p className="text-[0.95rem]">No density figure? Teagasc's guide puts pit silage of about 25% dry matter at one tonne per 1.39 m³, about {TEAGASC_DENSITY_25DM} kg/m³ (<Source code="S16" />). Only use it if yours is about that dry. Your winter plan will show it as a published figure, not your own.</p>
            <Button variant="secondary" block onClick={() => { setV({ ...v, density_kg_m3: String(TEAGASC_DENSITY_25DM) }); setDensityBasis('teagasc_25dm'); }}>Use {TEAGASC_DENSITY_25DM} kg/m³</Button>
          </div>
        )}
        {densityDoubt && (
          <div className="space-y-2 rounded-xl bg-warn-bg p-3" role="alert">
            <p className="font-bold text-warn">Your dry matter is not about 25%, so Teagasc's density may be well out.</p>
            {autoDensity({ ...row, density_kg_m3: null }) && <Button variant="secondary" block onClick={() => { setV({ ...v, density_kg_m3: '' }); setDensityBasis(null); }}>Work it out from my dry matter instead</Button>}
          </div>
        )}
        {method === 'bale_count' && <div className="grid grid-cols-2 gap-2"><NumberInput label="Bales" value={v.bale_count} onChange={set('bale_count')} integer /><NumberInput label="Avg bale weight" value={v.bale_weight_kg} onChange={set('bale_weight_kg')} unit="kg" /></div>}
        {method === 'measured_tonnes' && <NumberInput label="Fresh tonnes" value={v.measured_tonnes} onChange={set('measured_tonnes')} unit="t" />}
        {method === 'acreage' && <div className="grid grid-cols-2 gap-2"><NumberInput label="Acres" value={v.acreage} onChange={set('acreage')} unit="ac" /><NumberInput label="Expected yield" value={v.yield_t_per_acre} onChange={set('yield_t_per_acre')} unit="t/ac" /></div>}
        <NumberInput label="Already fed out" value={v.fed_out_tonnes} onChange={set('fed_out_tonnes')} unit="t" />
        <DateChips label="Measured on" value={measuredOn} onChange={setMeasuredOn} />
        <div className="rounded-xl bg-pasture p-3">
          <p className="font-bold" data-testid="store-tonnes">{est.tonnes !== null ? (est.tonnesHigh ? `About ${fmtNum(Math.round(est.tonnes))} to ${fmtNum(Math.round(est.tonnesHigh))} t fresh` : `About ${fmtNum(Math.round(est.tonnes))} t fresh`) : est.missing}</p>
          {est.dmTonnes !== undefined && <p className="text-[0.95rem]">That's about {fmtNum(Math.round(est.dmTonnes))} t of dry matter.</p>}
        </div>
        {est.tonnes !== null && <WinterLine before={winterBefore} after={winter} />}
      </Card>
      <Card className="space-y-4">
        <h2 className="text-lg font-bold">Dry matter</h2>
        <Chips<string> label="Which cut is it? (optional)" columns={3} value={cut ? String(cut) : null}
          onChange={(x) => setCut(cut === Number(x) ? null : (Number(x) as SilageCut))}
          options={([1, 2, 3] as SilageCut[]).map((c) => ({ value: String(c), label: CUT_LABEL[c] }))} />
        <NumberInput label="Dry matter from a silage test" value={v.dm_percent} onChange={set('dm_percent')} unit="%" hint="The DM figure on your lab report. Best of all if you have one." />
        {v.dm_percent === '' && (
          <div className="space-y-3">
            <p className="font-bold">No test yet? Check it in the yard</p>
            <Chips<'squeeze' | 'ball'> columns={2} value={testKind} onChange={setTestKind} options={[
              { value: 'squeeze', label: 'Squeeze test', sub: 'Wetter silage' },
              { value: 'ball', label: 'Ball test', sub: 'Drier, chopped silage' }
            ]} />
            <p className="text-[0.95rem]">{TEST_HOW[testKind]} What did you see?</p>
            <div className="grid gap-2" role="group" aria-label={`${testKind === 'squeeze' ? 'Squeeze' : 'Ball'} test result`}>
              {DM_TESTS.filter((t) => t.test === testKind).map((t) => {
                const on = dmTest === t.id;
                return (
                  <button key={t.id} type="button" aria-pressed={on} onClick={() => setDmTest(on ? null : t.id)}
                    className={`flex min-h-[56px] items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left text-[0.95rem] font-semibold ${on ? 'border-field bg-field text-white' : 'border-line bg-card text-ink'}`}>
                    <span className="flex items-center gap-2">{on && <Check className="h-5 w-5 shrink-0" strokeWidth={3} aria-hidden />}{t.saw}</span>
                    <span className={`shrink-0 text-sm ${on ? 'text-white/90' : 'text-muted'}`}>{bandLabel(t.low, t.high)}</span>
                  </button>
                );
              })}
            </div>
            <p className="hint">From Teagasc's silage factsheet (<Source code="S17" />). A yard test gives a range, not an exact figure.</p>
          </div>
        )}
        {dm && <p className="rounded-xl bg-pasture p-3 font-bold">{dm.text}</p>}
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="font-bold">What's typical{jurisdiction === 'NI' ? ' in Northern Ireland' : ''}</p>
          {typicalDm(jurisdiction, cut).map((l, i) => <p key={i} className="text-[0.95rem]">{l.text} <Source code={l.sourceCode} /></p>)}
          <p className="hint">Shown for guidance only. Nothing here is filled in for you.</p>
        </div>
      </Card>
      <Card className="space-y-4">
        <p className="font-bold">Rest of the lab analysis (optional)</p>
        <p className="hint">Stored for your records and advisor. Agri-It won't build a ration from it.</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="DMD" value={v.dmd_percent} onChange={set('dmd_percent')} unit="%" />
          <NumberInput label="Crude protein" value={v.crude_protein_percent} onChange={set('crude_protein_percent')} unit="%" />
          <NumberInput label="pH" value={v.ph} onChange={set('ph')} />
        </div>
      </Card>
      {ex && <Button variant="danger" block onClick={remove}>Remove</Button>}
      <SaveBar><Button block onClick={submit}>Save</Button></SaveBar>
    </Screen>
  );
}

/** What this store does to the whole winter plan, worked out as the farmer types. */
function WinterLine({ before, after }: { before: ReturnType<typeof forecastForage>; after: ReturnType<typeof forecastForage> }) {
  if (after.demandTPerMonth <= 0 || after.needWithReserveT === null) {
    return <p className="hint" data-testid="winter-line">Add your animal groups and housing and turnout dates to see how far this goes over the winter.</p>;
  }
  const months = after.monthsOfCover !== null ? after.monthsOfCover : 0;
  const need = Math.round(after.needWithReserveT);
  const have = Math.round(after.availableT);
  const gain = after.monthsOfCover !== null && before.monthsOfCover !== null ? after.monthsOfCover - before.monthsOfCover : after.monthsOfCover;
  const tone = after.status === 'surplus' ? 'bg-pasture' : after.status === 'tight' ? 'bg-warn-bg' : 'bg-warn-bg';
  return (
    <div className={`rounded-xl p-3 ${tone}`} data-testid="winter-line">
      <p className="font-bold">Your winter with this: {fmtNum(have)} t of {fmtNum(need)} t needed</p>
      <p className="text-[0.95rem]">
        {gain !== null && gain > 0 ? `This adds about ${gain.toFixed(1)} months of feeding. ` : ''}
        All your silage covers about {months.toFixed(1)} months at {fmtNum(Math.round(after.demandTPerMonth))} t a month
        {after.status === 'surplus' ? ', with your reserve.' : after.status === 'tight' ? ': enough for the winter, but not your reserve.' : ': short for the winter.'}
      </p>
    </div>
  );
}
