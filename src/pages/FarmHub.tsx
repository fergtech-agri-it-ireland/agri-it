import type { ComponentType, ReactNode } from 'react';
import {
  Banknote, BookOpen, ChevronRight, ClipboardList, FileSpreadsheet, ListChecks, MessageCircleQuestion, PiggyBank, Repeat, Settings, Sprout, Tractor, Truck, Users, Warehouse, Wheat
} from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { FARM_TYPE_LABEL, farmTypes, grows } from '../lib/farmTypes';
import { fmtNum } from '../lib/format';
import { List, Row, Screen } from '../components/ui';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h2 className="eyebrow px-1 pt-2">{title}</h2>
      <List>{children}</List>
    </section>
  );
}

/** More: everything that isn't on the dashboard or in the diary, in plain groups. */
export default function FarmHub() {
  const b = useFarmData();
  const d = useDerived(b);
  const types = farmTypes(b.farm);
  const heads = b.groups.filter((g) => !g.archived).reduce((s, g) => s + g.head_count, 0);
  const crops = b.crops.filter((c) => !c.archived);
  const open = b.jobs.filter((j) => !j.done_at).length;
  const unconfirmed = b.documents.filter((x) => x.state === 'unconfirmed').length + b.records.filter((r) => r.state === 'unconfirmed').length;
  const chev = <ChevronRight className="h-4 w-4 text-muted" aria-hidden />;
  const icon = (I: ComponentType<{ className?: string }>) => (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-field-light text-accent"><I className="h-[1.125rem] w-[1.125rem]" aria-hidden /></span>
  );
  const cropsRow = <Row to="/farm/crops" icon={icon(Sprout)} title="Crops" sub={crops.length ? `${crops.length} crops, ${fmtNum(crops.reduce((s, c) => s + Number(c.acres ?? 0), 0))} acres` : 'What you grow and the acres'} right={chev} />;

  return (
    <Screen title="More" sub={`${b.farm.name}, ${b.farm.county}`}>
      <Group title="Your farm">
        <Row to="/farm/types" icon={icon(Tractor)} title="What you farm" sub={types.length ? types.map((t) => FARM_TYPE_LABEL[t]).join(', ') : 'Not picked yet'} right={chev} />
        <Row to="/farm/groups" icon={icon(Users)} title="Animals and breeds" sub={heads ? `${b.groups.filter((g) => !g.archived).length} groups, ${fmtNum(heads)} head` : 'Add your groups'} right={chev} />
        {grows(types) && cropsRow}
        <Row to="/progress?tab=feed" icon={icon(Wheat)} title="Bought-in feed" sub={`${b.products.filter((p) => !p.archived).length} feeds tracked`} right={chev} />
        <Row to="/farm/silage" icon={icon(Warehouse)} title="Silage and bales" sub={d.forage.availableT ? `${fmtNum(Math.round(d.forage.availableT))} t in store` : 'Not recorded'} right={chev} />
        {!grows(types) && cropsRow}
      </Group>
      <Group title="Money">
        <Row to="/money" icon={icon(Banknote)} title="Money" sub="In and out, cash, budget" right={chev} />
        <Row to="/money/budget" icon={icon(PiggyBank)} title="Budget" sub="Plan the year by month" right={chev} />
        <Row to="/money/year-end" icon={icon(FileSpreadsheet)} title="Year-end pack" sub="For your accountant or advisor" right={chev} />
        <Row to="/suppliers" icon={icon(Truck)} title="Suppliers" sub="Numbers, your rep, lead times" right={chev} />
      </Group>
      <Group title="Records">
        <Row to="/diary?tab=history" icon={icon(BookOpen)} title="Diary history" sub="Everything recorded, and milk by month" right={chev} />
        <Row to="/records" icon={icon(ClipboardList)} title="Records" sub={unconfirmed ? `${unconfirmed} waiting for you to confirm` : 'Dockets, fertiliser, medicines, movements'} right={chev} />
        <Row to="/routines" icon={icon(Repeat)} title="Routines" sub={`${b.routines.filter((r) => r.active).length} routines, plus daily feeding`} right={chev} />
        <Row to="/farm/jobs" icon={icon(ListChecks)} title="Jobs" sub={open ? `${open} to do` : 'Nothing on the list'} right={chev} />
      </Group>
      <Group title="Help and settings">
        <Row to="/ask" icon={icon(MessageCircleQuestion)} title="Ask Agri-It" sub="Answers from your own records" right={chev} />
        <Row to="/settings" icon={icon(Settings)} title="Settings" sub="Farm details, bank balance, reminders" right={chev} />
      </Group>
    </Screen>
  );
}
