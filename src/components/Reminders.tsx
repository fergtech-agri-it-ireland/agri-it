import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff, BellRing, CalendarPlus, CloudUpload, X } from 'lucide-react';
import type { FarmBundle } from '../lib/types';
import { todayISO } from '../lib/format';
import { buildDigest, EVENING_TIMES, MORNING_TIMES, nextReminder, remindersIcs, timeLabel, anyOn, type SlotId } from '../lib/reminders';
import { downloadIcs, enableNotifications, notifyState, useReminderPrefs, type NotifyState } from '../lib/reminderClock';
import { Button, Card, Chips, ToneIcon } from './ui';
import { IS_ONLINE, key } from '../lib/env';
import { disableServerPush, enableServerPush, serverPushState, type ServerPushState } from '../lib/serverPush';
import type { Digest } from '../lib/reminders';

/** Looks like the phone's lock-screen notification, so the farmer sees exactly what they'll get. */
function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-inverse p-3 text-oninverse" aria-label="Preview of the reminder">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-field"><BellRing className="h-5 w-5 text-white" aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-wide opacity-75">Agri-It</span>
        <b className="block leading-snug">{title}</b>
        <span className="block text-[0.95rem] opacity-90">{body}</span>
      </span>
    </div>
  );
}

const STATUS: Record<NotifyState, string> = {
  demo: 'Phone notifications and calendar alarms work in the installed app. This demo shows the preview only.',
  unsupported: 'This browser cannot show notifications. Put the reminder times in your phone calendar instead.',
  default: 'Allow notifications so Agri-It can buzz your phone at these times.',
  granted: 'Notifications are on for this phone. If Agri-It is closed, the phone checks in the background and can be a little late. For an exact alarm, add the times to your calendar too.',
  denied: 'Notifications are blocked for Agri-It in your phone settings. You can still put the reminder times in your phone calendar.'
};

export function RemindersCard({ b, urgentToday }: { b: FarmBundle; urgentToday: string[] }) {
  const [prefs, setPrefs] = useReminderPrefs();
  const [state, setState] = useState<NotifyState>(notifyState);
  const today = todayISO();
  const digest = useMemo(() => buildDigest(b, today, prefs, urgentToday), [b, today, prefs, urgentToday]);
  const next = nextReminder(prefs, new Date());
  const day = next ? digest.days[next.tomorrow ? 1 : 0] : null;
  const msg = next && day ? day.messages[next.slot] : null;

  const pick = (slot: SlotId) => (v: string) => setPrefs({ ...prefs, [slot]: v === 'off' ? null : v });
  const opts = (times: string[]) => [{ value: 'off', label: 'Off' }, ...times.map((t) => ({ value: t, label: timeLabel(t) }))];

  return (
    <Card className="space-y-4">
      <Chips label="Morning reminder" columns={3} value={prefs.morning ?? 'off'} onChange={pick('morning')} options={opts(MORNING_TIMES)} />
      <Chips label="Evening check" columns={3} value={prefs.evening ?? 'off'} onChange={pick('evening')} options={opts(EVENING_TIMES)}
        hint="Only if something is still not ticked off." />

      {next && (
        <div className="space-y-2">
          <p className="font-bold">{next.tomorrow ? 'Tomorrow' : 'Today'} at {timeLabel(next.time)} it would say</p>
          {msg ? <NotificationPreview title={msg.title} body={msg.body} />
            : <p className="rounded-xl bg-pasture p-3 text-muted">Nothing to tick off then, so no reminder is sent.</p>}
        </div>
      )}

      {anyOn(prefs) && (
        <>
          <p className="flex gap-2 text-[0.95rem]"><ToneIcon tone={state === 'granted' ? 'ok' : state === 'denied' ? 'warn' : 'info'} className="mt-0.5 h-5 w-5 shrink-0" />{STATUS[state]}</p>
          {state === 'default' && (
            <Button variant="hivis" block onClick={async () => setState(await enableNotifications())}>
              <BellRing className="h-6 w-6" aria-hidden />Allow notifications
            </Button>
          )}
          {IS_ONLINE && <ServerPush farmId={b.farm.id} digest={digest} onState={setState} />}
          {state !== 'demo' && <Button variant="secondary" block onClick={() => downloadIcs(remindersIcs(prefs, location.origin + location.pathname, today, b.farm.id))}>
            <CalendarPlus className="h-6 w-6" aria-hidden />Add to phone calendar
          </Button>}
        </>
      )}
      <p className="hint">Only changes this phone. A reminder never records anything: tapping it opens Today, where you tick things off.</p>
    </Card>
  );
}

const SERVER_TEXT: Record<ServerPushState, string> = {
  on: 'Server reminders are on for this phone. They arrive even when Agri-It is closed, with the same words as the preview.',
  off: 'Get the reminder even when Agri-It is closed (needed on iPhone). Agri-It\'s server sends it at your time.',
  unsupported: 'This browser cannot get reminders from the server. Use the calendar instead.',
  denied: 'Notifications are blocked for Agri-It Online in your phone settings, so the server cannot send reminders.',
  'needs-install': 'On iPhone, add Agri-It Online to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn this on.'
};

/** Online build: opt this phone in to reminders sent by the server (edge function push-reminders). */
function ServerPush({ farmId, digest, onState }: { farmId: string; digest: Digest; onState: (s: NotifyState) => void }) {
  const [st, setSt] = useState<ServerPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void serverPushState().then(setSt); }, []);
  if (!st) return null;
  const turnOn = async () => {
    setBusy(true); setErr(null);
    try { const s = await enableServerPush(farmId, digest); setSt(s); onState(notifyState()); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true); setErr(null);
    try { await disableServerPush(); setSt('off'); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-2xl bg-pasture p-3">
      <p className="flex gap-2 text-[0.95rem]"><ToneIcon tone={st === 'on' ? 'ok' : st === 'off' ? 'info' : 'warn'} className="mt-0.5 h-5 w-5 shrink-0" />{SERVER_TEXT[st]}</p>
      {st === 'off' && (
        <Button variant="hivis" block disabled={busy} onClick={turnOn}>
          <CloudUpload className="h-6 w-6" aria-hidden />{busy ? 'Turning on…' : 'Send reminders when Agri-It is closed'}
        </Button>
      )}
      {st === 'on' && (
        <Button variant="secondary" block disabled={busy} onClick={turnOff}>
          <BellOff className="h-6 w-6" aria-hidden />{busy ? 'Turning off…' : 'Stop server reminders on this phone'}
        </Button>
      )}
      {err && <p className="font-bold text-danger" role="alert">{err}</p>}
    </div>
  );
}

const NUDGE_KEY = key('reminder-nudge');

/** One-time suggestion on Today, only when there's a checklist and no reminders set. */
export function ReminderNudge() {
  const [prefs] = useReminderPrefs();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(NUDGE_KEY) === '1'; } catch { return false; } });
  if (hidden || anyOn(prefs)) return null;
  const dismiss = () => { try { localStorage.setItem(NUDGE_KEY, '1'); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="flex items-center gap-2 rounded-[1.125rem] bg-field-light pl-2">
      <Link to="/settings?section=reminders" className="flex min-h-tap flex-1 items-center gap-3 py-2 font-bold text-accent">
        <BellRing className="h-7 w-7 shrink-0" aria-hidden />
        <span>Get a nudge at milking time to tick these off</span>
      </Link>
      <button onClick={dismiss} aria-label="Not now" className="flex min-h-tap min-w-tap items-center justify-center text-muted"><X className="h-6 w-6" aria-hidden /></button>
    </div>
  );
}
