import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useFarmData } from '../lib/data/farm';
import { useDerived } from '../lib/data/derived';
import { ask, SUGGESTED, type Answer } from '../lib/ask';
import { CallButton, Card, ConfidenceBadge, Screen, VoiceButton } from '../components/ui';

export default function Ask() {
  const b = useFarmData();
  const d = useDerived(b);
  const [q, setQ] = useState('');
  const [thread, setThread] = useState<{ q: string; a: Answer }[]>([]);
  const run = (text: string) => { if (text.trim()) { setThread((t) => [{ q: text, a: ask(text, b, d) }, ...t]); setQ(''); } };
  const submit = (e: FormEvent) => { e.preventDefault(); run(q); };

  return (
    <Screen title="Ask Agri-It" back sub="Answers only from your records">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="ask" className="sr-only">Question</label>
        <input id="ask" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. When do I order meal?" />
        <VoiceButton onText={(t) => run(t)} />
        <button aria-label="Ask" className="flex min-h-tap min-w-tap items-center justify-center rounded-xl bg-field text-white"><Send className="h-6 w-6" /></button>
      </form>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED.map((s) => <button key={s} onClick={() => run(s)} className="min-h-[2.75rem] rounded-full border-2 border-line bg-card px-3 text-left font-bold">{s}</button>)}
      </div>
      {thread.map(({ q: question, a }, i) => (
        <Card key={i} className="space-y-2">
          <p className="text-sm font-bold text-muted">{question}</p>
          <p className="text-xl font-bold leading-snug">{a.text}</p>
          {a.details.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{a.details.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {a.confidence && <ConfidenceBadge level={a.confidence} />}
            <span className="text-sm text-muted">Based on: {a.basis}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {a.call && <CallButton phone={a.call.phone} label={a.call.label} />}
            {a.links.map((l) => <Link key={l.to} to={l.to} className="inline-flex min-h-tap items-center rounded-2xl border-2 border-ink/80 px-4 font-bold">{l.label}</Link>)}
          </div>
        </Card>
      ))}
    </Screen>
  );
}
