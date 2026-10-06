import { ChevronRight, ClipboardList, ListChecks, MessageCircleQuestion, Settings, Truck, Users, Warehouse, Wheat } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { fmtNum } from '../lib/format';
import { List, Row, Screen } from '../components/ui';

export default function FarmHub() {
  const b = useFarmData();
  const d = useDerived(b);
  const heads = b.groups.filter((g) => !g.archived).reduce((s, g) => s + g.head_count, 0);
  const open = b.jobs.filter((j) => !j.done_at).length;
  const unconfirmed = b.documents.filter((x) => x.state === 'unconfirmed').length + b.records.filter((r) => r.state === 'unconfirmed').length;
  const chev = <ChevronRight className="h-5 w-5 text-muted" aria-hidden />;
  const icon = (I: typeof Users) => <I className="h-6 w-6 text-field" aria-hidden />;
  return (
    <Screen title="Farm" sub={`${b.farm.county}${b.farm.eircode ? `, ${b.farm.eircode}` : ''}`}>
      <List>
        <Row to="/farm/groups" icon={icon(Users)} title="Animal groups" sub={`${b.groups.filter((g) => !g.archived).length} groups, ${heads} head`} right={chev} />
        <Row to="/forecast?tab=feed" icon={icon(Wheat)} title="Bought-in feed" sub={`${b.products.filter((p) => !p.archived).length} feeds tracked`} right={chev} />
        <Row to="/farm/silage" icon={icon(Warehouse)} title="Silage and bales" sub={d.forage.availableT ? `${fmtNum(Math.round(d.forage.availableT))} t in store` : 'Not recorded'} right={chev} />
        <Row to="/suppliers" icon={icon(Truck)} title="Suppliers" sub="Numbers, your rep, lead times" right={chev} />
      </List>
      <List>
        <Row to="/records" icon={icon(ClipboardList)} title="Records" sub={unconfirmed ? `${unconfirmed} waiting for you to confirm` : 'Dockets, fertiliser, medicines, movements'} right={chev} />
        <Row to="/farm/jobs" icon={icon(ListChecks)} title="Jobs" sub={open ? `${open} to do` : 'Nothing on the list'} right={chev} />
        <Row to="/ask" icon={icon(MessageCircleQuestion)} title="Ask Agri-It" sub="Answers from your own records" right={chev} />
        <Row to="/settings" icon={icon(Settings)} title="Settings" sub="Farm details, bank balance, housing dates" right={chev} />
      </List>
    </Screen>
  );
}
