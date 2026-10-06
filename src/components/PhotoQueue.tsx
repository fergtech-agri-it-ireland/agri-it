import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, ScanText, X } from 'lucide-react';
import { useFarmCtx, useFarmData } from '../lib/data/farm';
import { interpret, readWaiting } from '../lib/docket/flow';
import { dropToRead, listToRead, subscribePhotos, type ToRead } from '../lib/docket/photoStore';
import { kindLabel, usable, type DocketRead } from '../lib/docket/extract';
import { setPendingPhoto } from '../lib/pendingPhoto';
import { eur, fmtKg } from '../lib/format';
import { usePhotoUrl } from './PhotoRead';

export function usePhotoQueue(): ToRead[] {
  const { farmId } = useFarmCtx();
  const [items, setItems] = useState<ToRead[]>([]);
  const load = useCallback(() => { if (farmId) listToRead(farmId).then(setItems).catch(() => setItems([])); }, [farmId]);
  useEffect(() => { load(); return subscribePhotos(load); }, [load]);
  return items;
}

/** One line saying what a read found, e.g. "Tirlán FarmLife, Dairy nut 16%, 3 t". */
export function readHeadline(r: DocketRead): string {
  const bits = [usable(r.supplier)?.payee ?? usable(r.supplier)?.text, usable(r.product)?.name ?? usable(r.product)?.text];
  const kg = usable(r.quantity)?.kg;
  if (kg) bits.push(fmtKg(kg));
  const money = usable(r.total) ?? usable(r.net);
  if (money !== undefined) bits.push(eur(money, true));
  return bits.filter(Boolean).join(', ') || 'Nothing could be read clearly';
}

function Thumb({ blob }: { blob: Blob }) {
  const url = usePhotoUrl(blob);
  return url ? <img src={url} alt="" className="h-14 w-12 shrink-0 rounded-lg border-2 border-line object-cover" /> : null;
}

/** Record screen: photos kept to read later, and ones read and waiting to be checked. */
export function PhotoQueueList() {
  const b = useFarmData();
  const { farmId } = useFarmCtx();
  const nav = useNavigate();
  const items = usePhotoQueue();
  useEffect(() => { if (farmId && navigator.onLine) readWaiting(farmId).catch(() => {}); }, [farmId]);
  if (!items.length) return null;
  return (
    <section className="mb-4" data-testid="photo-queue">
      <h2 className="h-display mb-2 mt-4 text-2xl">Photos to check</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card shadow-lift">
        {items.map((p) => {
          const read = p.status === 'read' && p.lines ? interpret(p.lines, p.reader ?? 'Read on this phone', b) : null;
          const open = () => {
            setPendingPhoto(new File([p.blob], p.name, { type: p.blob.type || 'image/jpeg' }), read, p.id);
            nav(read?.route === 'cost' ? '/record/cost' : read ? '/record/delivery' : '/record/cost');
          };
          return (
            <div key={p.id} className="flex min-h-[4.5rem] items-center gap-3 py-2 pl-3 pr-1.5">
              <Thumb blob={p.blob} />
              <div className="min-w-0 flex-1">
                {read ? (
                  <><b className="flex items-center gap-1.5 leading-snug"><ScanText className="h-4 w-4 text-accent" aria-hidden />{kindLabel(read)}</b><span className="text-[0.95rem] text-muted">{readHeadline(read)}</span></>
                ) : p.status === 'failed' ? (
                  <><b className="block leading-snug">Couldn&apos;t read this one</b><span className="text-[0.95rem] text-muted">{p.error ?? 'Fill it in yourself'}</span></>
                ) : (
                  <><b className="flex items-center gap-1.5 leading-snug"><Clock className="h-4 w-4" aria-hidden />Waiting to be read</b><span className="text-[0.95rem] text-muted">Reads when you have signal</span></>
                )}
              </div>
              {p.status !== 'waiting' && <button onClick={open} className="min-h-[3.5rem] shrink-0 rounded-2xl bg-hivis px-3 font-bold text-onhivis">{read ? 'Check' : 'Fill in'}</button>}
              <button onClick={() => dropToRead(p.id)} aria-label="Remove this photo" className="flex h-14 w-12 shrink-0 items-center justify-center rounded-full hover:bg-field-light"><X className="h-6 w-6" aria-hidden /></button>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-sm text-muted">Nothing is recorded from these until you check and save.</p>
    </section>
  );
}

/** Today: a nudge when photos have been read and are waiting to be checked. */
export function PhotoQueueNudge() {
  const items = usePhotoQueue().filter((p) => p.status === 'read');
  if (!items.length) return null;
  return (
    <Link to="/record" className="flex min-h-tap items-center gap-2 rounded-2xl bg-field-light px-4 py-2 font-bold text-accent" data-testid="photo-nudge">
      <ScanText className="h-5 w-5" aria-hidden />{items.length === 1 ? '1 photo read, ready to check' : `${items.length} photos read, ready to check`}
    </Link>
  );
}
