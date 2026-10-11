import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFarmData, useFarmCtx } from '../lib/data/farm';
import { supabase } from '../lib/supabase';
import { appLink, IN_BROWSER, IN_FRAME } from '../lib/env';
import { ROLE_LABEL, type MemberRole } from '../lib/types';
import { Button, Card, Chips, Empty, List, Row, Screen, SectionTitle, TextInput } from '../components/ui';
import { useToast } from '../components/Toast';

/** What each role can do, in the farmer's words. */
export const ROLE_HELP: Record<MemberRole, string> = {
  owner: 'Everything, including money and who has access.',
  member: 'Everything a farmer records, including money. Cannot add or remove people.',
  worker: 'Feeding, deliveries, counts, jobs and records. Does not see money, bills or prices.',
  advisor: 'Reads everything, including money and the year-end pack. Cannot change anything.'
};

/**
 * Shared access (review gap P1): owner, family or partner, farm worker, adviser or accountant.
 * Invitations go by email; the person accepts once signed in with that email. Every change
 * to a sensitive record is kept in the change history.
 */
export default function People() {
  const b = useFarmData();
  const { farmId, session } = useFarmCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = b.role === 'owner';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('worker');
  const [link, setLink] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ['people', farmId],
    enabled: !IN_BROWSER && !!farmId,
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_members').select('user_id, role, email').eq('farm_id', farmId!);
      if (error) throw error;
      return data as { user_id: string; role: MemberRole; email: string | null }[];
    }
  });
  const invites = useQuery({
    queryKey: ['invites', farmId],
    enabled: !IN_BROWSER && !!farmId && owner,
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_invites').select('id, email, role, expires_at, accepted_at').eq('farm_id', farmId!);
      if (error) throw error;
      return (data as { id: string; email: string; role: MemberRole; expires_at: string; accepted_at: string | null }[]).filter((i) => !i.accepted_at);
    }
  });
  useEffect(() => { setLink(null); }, [email, role]);

  if (IN_BROWSER) {
    return (
      <Screen title="People on this farm" back="/settings">
        <Empty title="Just you, on this phone" body="This version keeps the farm on one phone, with no accounts, so it can't be shared yet. Once Agri-It runs online, the owner can invite family, a farm worker (no money) or an adviser (read only), and every change is kept in the change history." />
        <SectionTitle>What each person will be able to do</SectionTitle>
        <List>{(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => <Row key={r} title={ROLE_LABEL[r]} sub={ROLE_HELP[r]} />)}</List>
      </Screen>
    );
  }

  async function invite() {
    const { data, error } = await supabase.rpc('create_farm_invite', { p_farm_id: farmId, p_email: email.trim(), p_role: role });
    if (error) { toast.show({ message: error.message, tone: 'error' }); return; }
    const url = appLink(`/join/${data}`);
    setLink(url);
    qc.invalidateQueries({ queryKey: ['invites', farmId] });
    try { await navigator.clipboard.writeText(url); toast.show({ message: 'Invitation link copied. Send it by text or email.', tone: 'success' }); } catch { /* shown below to copy by hand */ }
  }
  async function setMemberRole(userId: string, r: MemberRole) {
    const { error } = await supabase.from('farm_members').update({ role: r }).match({ farm_id: farmId, user_id: userId });
    if (error) toast.show({ message: error.message, tone: 'error' }); else qc.invalidateQueries({ queryKey: ['people', farmId] });
  }
  async function remove(userId: string) {
    const { error } = await supabase.from('farm_members').delete().match({ farm_id: farmId, user_id: userId });
    if (error) toast.show({ message: error.message, tone: 'error' }); else qc.invalidateQueries({ queryKey: ['people', farmId] });
  }
  async function cancelInvite(id: string) {
    await supabase.from('farm_invites').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['invites', farmId] });
  }

  return (
    <Screen title="People on this farm" back="/settings">
      <List>
        {(people.data ?? []).map((p) => (
          <Row key={p.user_id} title={`${p.email ?? 'Someone'}${p.user_id === session?.user.id ? ' (you)' : ''}`} sub={`${ROLE_LABEL[p.role]}. ${ROLE_HELP[p.role]}`}
            right={owner && p.role !== 'owner' ? <Button variant="ghost" onClick={() => remove(p.user_id)}>Remove</Button> : undefined} />
        ))}
      </List>
      {owner && (people.data ?? []).filter((p) => p.role !== 'owner').map((p) => (
        <Chips<MemberRole> key={p.user_id} label={`${p.email ?? 'Someone'} can`} columns={3} value={p.role} onChange={(r) => setMemberRole(p.user_id, r)}
          options={(['member', 'worker', 'advisor'] as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      ))}

      {owner ? (
        <>
          <SectionTitle>Invite someone</SectionTitle>
          <Card className="space-y-4">
            <TextInput label="Their email" value={email} onChange={setEmail} placeholder="name@example.com" />
            <Chips<MemberRole> label="They are" columns={3} value={role} onChange={setRole}
              options={(['member', 'worker', 'advisor'] as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} hint={ROLE_HELP[role]} />
            <Button block disabled={!/.+@.+\..+/.test(email)} onClick={invite}>Make an invitation link</Button>
            {link && <p className="break-all rounded-xl bg-field-light p-3 text-sm">{IN_FRAME ? 'Copy this link and send it: ' : ''}{link}</p>}
            <p className="text-sm text-muted">They sign in with that email and open the link. It works once and runs out after 14 days.</p>
          </Card>
          {(invites.data ?? []).length > 0 && (
            <>
              <SectionTitle>Waiting to accept</SectionTitle>
              <List>{invites.data!.map((i) => <Row key={i.id} title={i.email} sub={ROLE_LABEL[i.role]} right={<Button variant="ghost" onClick={() => cancelInvite(i.id)}>Cancel</Button>} />)}</List>
            </>
          )}
        </>
      ) : <Card><p className="text-muted">Only the farm owner can add or remove people.</p></Card>}
    </Screen>
  );
}
