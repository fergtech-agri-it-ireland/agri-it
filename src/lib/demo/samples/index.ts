/** Sample docket photos for trying photo reading in the demo (all marked SAMPLE on the paper). */
import feedDocket from './feed-docket.jpg';
import vetReceipt from './vet-receipt.jpg';
import supplierInvoice from './supplier-invoice.jpg';

export const SAMPLES = [
  { name: 'feed-docket.jpg', label: 'Feed docket', sub: 'Crooked, dim shed light', url: feedDocket },
  { name: 'vet-receipt.jpg', label: 'Vet receipt', sub: 'Folded and creased', url: vetReceipt },
  { name: 'supplier-invoice.jpg', label: 'Feed invoice', sub: 'Dark, with a fold', url: supplierInvoice }
];

export async function sampleFile(s: (typeof SAMPLES)[number]): Promise<File> {
  const blob = await (await fetch(s.url)).blob();
  return new File([blob], s.name, { type: 'image/jpeg' });
}
