import { useQuery } from '@tanstack/react-query';
import { useFarmData, useFarmCtx } from '../lib/data/farm';
import { supabase } from '../lib/supabase';
import type { AuditEntry } from '../lib/types';
import { describeChange } from '../lib/audit';
import { Card, Empty, List, Row, Screen } from '../components/ui';

/** Who created, changed or removed what, and when (review gap P1: audit trail). */
export default function Changes() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const q = useQuery({
    queryKey: ['audit', farmId],
    enabled: !!farmId,
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_log').select('*').eq('farm_id', farmId!).order('changed_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as AuditEntry[];
    }
  });
  const canSee = b.role === 'owner' || b.role === 'advisor' || b.role === undefined;
  return (
    <Screen title="Change history" back="/settings" sub="Money, feed, animals and records">
      {!canSee ? <Card><p className="text-muted">Only the owner and the farm's adviser can see the change history.</p></Card>
        : q.isLoading ? <Card><p className="text-muted">Loading…</p></Card>
        : q.error ? <Card><p className="text-danger">{(q.error as Error).message}</p></Card>
        : !q.data?.length ? <Empty title="No changes yet" body="Every record that is added, changed or removed shows here, with who did it and when." />
        : (
          <List>
            {q.data.map((e) => {
              const d = describeChange(e, b);
              return <Row key={e.id} title={d.title} sub={`${d.detail}${d.detail ? '. ' : ''}${e.changed_by_label ?? 'Someone'}, ${new Date(e.changed_at).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`} />;
            })}
          </List>
        )}
      <p className="px-1 text-sm text-muted">Kept so you, your adviser or an inspector can see how a figure came about. It does not replace any official register.</p>
    </Screen>
  );
}
