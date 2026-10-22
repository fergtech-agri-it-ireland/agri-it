import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Keyboard, ListPlus } from 'lucide-react';
import { Card, List, Row, Screen } from '../components/ui';
import { ScanButton } from '../components/ScanButton';
import { IS_DEMO } from '../lib/env';

/** Three ways to add animals: scan the blue card, type one tag, or paste a list. */
export default function AnimalAdd() {
  const nav = useNavigate();
  return (
    <Screen title="Add animals" back="/animals">
      <Card className="space-y-2">
        <ScanButton onFile={(photo) => nav('/animals/new', { state: { photo } })} label={IS_DEMO ? 'Pick a photo of the animal card' : 'Scan the blue animal card'} />
        <p className="text-[0.8125rem] text-muted">Reads the tag number off the identity card on this phone. You check it, then save. One animal at a time.</p>
      </Card>
      <List>
        <Row to="/animals/new" icon={<Keyboard className="h-6 w-6 text-accent" aria-hidden />} title="Type one tag" sub="One animal, with its details" right={<ChevronRight className="h-5 w-5 text-muted" aria-hidden />} />
        <Row to="/animals/many" icon={<ListPlus className="h-6 w-6 text-accent" aria-hidden />} title="Add several at once" sub="Paste or type a list of tags that share a group, breed or birth date" right={<ChevronRight className="h-5 w-5 text-muted" aria-hidden />} />
      </List>
      <p className="px-1 text-[0.8125rem] text-muted">Starting a herd or flock of hundreds? Add several at once, then open <Link to="/animals/herd" className="font-bold text-accent underline">Find and manage</Link> to fill in the rest.</p>
    </Screen>
  );
}
