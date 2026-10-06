import { describe, expect, it } from 'vitest';
import { datesIn, matchProduct, matchSupplier, nameScore, numbersIn, readDocket, usable, type MatchContext, type OcrLine } from './extract';
import { SAMPLE_TEXT } from '../demo/samples/sampleText';

const ctx: MatchContext = {
  today: '2026-10-07',
  suppliers: [
    { id: 'tirlan', name: 'Tirlán FarmLife', network: 'GAIN Feeds' },
    { id: 'dairygold', name: 'Dairygold Agri Business' },
    { id: 'lakeland', name: 'Lakeland Dairies Agribusiness' },
    { id: 'fane', name: 'Fane Valley Feeds' },
    { id: 'arrabawn', name: 'Arrabawn Tipperary Co-op' }
  ],
  products: [
    { id: 'nut16', name: 'Dairy nut 16%', supplier_id: 'tirlan' },
    { id: 'calf', name: 'Calf ration', supplier_id: 'tirlan' }
  ],
  payees: ['Suir Valley Vets', 'Murphy Contracting']
};
const L = (...t: string[]): OcrLine[] => t.map((text) => ({ text, confidence: 92 }));

describe('reading the demo sample photos (real reader output)', () => {
  it('feed docket: Tirlán, Dairy nut 16%, 3 t with the unit worked out from the sums', () => {
    const r = readDocket(SAMPLE_TEXT['feed-docket.jpg'], ctx, 'test');
    expect(r.kind).toBe('docket');
    expect(r.isFeed).toBe(true);
    expect(r.route).toBe('delivery');
    expect(r.supplier?.value.supplierId).toBe('tirlan');
    expect(r.product?.value.feedProductId).toBe('nut16');
    expect(r.quantity?.value.kg).toBe(3000);
    expect(r.quantity?.note).toMatch(/worked out/);
    expect(r.quantity?.confidence).toBe('medium');
    expect(r.pricePerTonne?.value).toBe(392);
    expect(r.total?.value).toBe(1176);
    expect(r.date?.value).toBe('2026-10-05');
    expect(r.docNumber?.value).toBe('D-482917');
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('vet receipt: a bill, vet and medicine, matched to the farmer\'s own payee spelling, VAT checked', () => {
    const r = readDocket(SAMPLE_TEXT['vet-receipt.jpg'], ctx, 'test');
    expect(r.kind).toBe('receipt');
    expect(r.isFeed).toBe(false);
    expect(r.route).toBe('cost');
    expect(r.costCategory?.value).toBe('vet_medicine');
    expect(r.supplier?.value.supplierId).toBeNull();
    expect(r.supplier?.value.payee).toBe('Suir Valley Vets');
    expect(r.total?.value).toBe(202.6);
    expect(r.net?.value).toBe(178.5);
    expect(r.vat?.value).toEqual({ eur: 24.1, ratePercent: 13.5 });
    expect(r.date?.value).toBe('2026-10-02');
    expect(r.docNumber?.value).toBe('20871');
    expect(r.checks).toEqual([{ ok: true, text: expect.stringContaining('= total €202.60') }]);
  });

  it('supplier invoice for feed: Dairygold, rate read off the product line', () => {
    const r = readDocket(SAMPLE_TEXT['supplier-invoice.jpg'], ctx, 'test');
    expect(r.kind).toBe('invoice');
    expect(r.route).toBe('delivery');
    expect(r.supplier?.value.supplierId).toBe('dairygold');
    expect(r.product?.value.feedProductId).toBe('nut16');
    expect(r.quantity?.value.kg).toBe(2500);
    expect(r.pricePerTonne?.value).toBe(388);
    expect(r.net?.value).toBe(970);
    expect(r.total?.value).toBe(970);
    expect(r.vat?.value.eur).toBe(0);
    expect(r.date?.value).toBe('2026-09-29');
    expect(r.docNumber?.value).toBe('INV-2026-118834');
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe('never guessing', () => {
  it('leaves quantity blank when the unit is unreadable and the sums cannot settle it', () => {
    const r = readDocket(L('Tirlan FarmLife', 'Delivery Docket', 'Date: 03/10/2026', 'DAIRY NUT 16% 3.00 ?'), ctx, 'test');
    expect(r.quantity).toBeUndefined();
    expect(r.suggestions).toContainEqual({ field: 'quantity', text: "Saw 3.00 but couldn't read the unit", value: 3 });
    expect(r.missing).toContain('quantity');
    expect(r.missing).toContain('price');
  });

  it('a quantity worked out from value and price is offered, not filled in', () => {
    const r = readDocket(L('Tirlan FarmLife', 'Delivery Docket', 'Calf ration', 'Price per tonne 450.00', 'Value 225.00'), ctx, 'test');
    expect(r.quantity).toBeUndefined();
    expect(r.suggestions).toContainEqual({ field: 'quantity', text: 'Value ÷ price per tonne gives 0.5 t', value: 500 });
  });

  it('a date in the future or months old is only a suggestion', () => {
    const r = readDocket(L('Murphy Contracting', 'Receipt', 'Date 14/03/2026', 'Silage cutting', 'Total 1,450.00'), ctx, 'test');
    expect(r.date?.confidence).toBe('low');
    expect(usable(r.date)).toBeUndefined();
    expect(r.suggestions[0]).toMatchObject({ field: 'date', value: '2026-03-14' });
    expect(r.missing).toContain('date');
  });

  it('low-confidence reader lines are not usable', () => {
    const r = readDocket([{ text: 'Receipt', confidence: 90 }, { text: 'TOTAL 8S.40', confidence: 41 }], ctx, 'test');
    expect(r.total?.value).toBe(85.4);
    expect(r.total?.confidence).toBe('low');
    expect(usable(r.total)).toBeUndefined();
  });

  it('a total that does not add up is marked low and explained', () => {
    const r = readDocket(L('Dairygold Agri Business', 'Sales Invoice', 'Invoice Date: 01/10/2026', 'Net 500.00', 'VAT 13.5% 67.50', 'Total due EUR 576.50'), ctx, 'test');
    expect(r.total?.confidence).toBe('low');
    expect(r.checks[0].ok).toBe(false);
  });

  it('a page with no readable money or names has nothing filled in', () => {
    const r = readDocket(L('~~ ;; ..', 'II l1'), ctx, 'test');
    expect(r.kind).toBe('unknown');
    expect(r.total).toBeUndefined();
    expect(r.supplier).toBeUndefined();
    expect(r.missing.length).toBeGreaterThan(0);
  });
});

describe('fields', () => {
  it('reads bag quantities, kg and tonnes', () => {
    expect(readDocket(L('Receipt', 'Calf ration 40 x 25kg', 'Total 520.00'), ctx, 't').quantity?.value.kg).toBe(1000);
    expect(readDocket(L('Docket', 'Calf ration 750 kg'), ctx, 't').quantity?.value.kg).toBe(750);
    expect(readDocket(L('Docket', 'Dairy nuts 16% 4.5 tonnes'), ctx, 't').quantity?.value.kg).toBe(4500);
    expect(readDocket(L('Docket', 'Product: Dairy nut 16%', 'Nett weight 6,000 kg'), ctx, 't').quantity?.value.kg).toBe(6000);
  });

  it('reads day-first dates in the usual Irish forms and skips due dates', () => {
    expect(datesIn('Date: 5/10/26')).toEqual(['2026-10-05']);
    expect(datesIn('Delivered 3rd October 2026')).toEqual(['2026-10-03']);
    expect(datesIn('Oct 4, 2026')).toEqual(['2026-10-04']);
    expect(datesIn('31/02/2026')).toEqual([]);
    const r = readDocket(L('Sales Invoice', 'Payment due 30/10/2026', 'Invoice date 01.10.2026', 'Total 10.00'), ctx, 't');
    expect(r.date?.value).toBe('2026-10-01');
  });

  it('tells money from percentages and fixes letters read as digits', () => {
    const n = numbersIn('VAT @ 13.5% 24.1O');
    expect(n.map((x) => [x.value, x.percent])).toEqual([[13.5, true], [24.1, false]]);
    expect(numbersIn('EUR 1,176.00')[0].value).toBe(1176);
  });

  it('works out the cost category from the words on the bill', () => {
    expect(readDocket(L('Kelly Fuels', 'Receipt', 'Green diesel 500 L', 'Total 495.00'), ctx, 't').costCategory?.value).toBe('machinery_fuel');
    expect(readDocket(L('Agri Store', 'Invoice', 'CAN 27% N 2.0t', 'Total 640.00'), ctx, 't').costCategory?.value).toBe('fertiliser');
    expect(readDocket(L('Murphy Contracting', 'Receipt', 'Slurry spreading 6 hrs', 'Total 480.00'), ctx, 't').costCategory?.value).toBe('contractor');
  });
});

describe('matching', () => {
  it('matches suppliers by distinctive name, accents and one smudged letter', () => {
    expect(matchSupplier(L('TIRLAN FARMLIFE'), ctx)?.id).toBe('tirlan');
    expect(matchSupplier(L('GAIN Feeds by Tirlan'), ctx)?.id).toBe('tirlan');
    expect(matchSupplier(L('Dairyg0ld Agri Business'.replace('0', 'o').replace('y', 'v')), ctx)?.id).toBe('dairygold');
  });

  it('does not match on shared generic words', () => {
    expect(matchSupplier(L('Suir Valley Veterinary Clinic'), ctx)).toBeNull();
    // A county in an address is not a supplier name ("Arrabawn Tipperary Co-op")
    expect(matchSupplier(L('Suir Valley Veterinary Clinic', 'Main St, Cahir, Co. Tipperary'), ctx)).toBeNull();
    expect(matchSupplier(L('Arrabawn Tipperary'), ctx)?.id).toBe('arrabawn');
    expect(nameScore('Lakeland Dairies Agribusiness', 'Kerry Dairies')).toBe(0);
  });

  it('matches feeds but never across protein percentages', () => {
    expect(matchProduct('DAIRY NUTS 16% CP 3.00t', ctx.products)?.id).toBe('nut16');
    expect(matchProduct('DAIRY NUT 14% CP 3.00t', ctx.products)).toBeNull();
    expect(matchProduct('Calf Rations 20 x 25kg', ctx.products)?.id).toBe('calf');
    expect(matchProduct('Beef finisher 12%', ctx.products)).toBeNull();
  });

  it('an unmatched feed is named but not assigned', () => {
    const r = readDocket(L('Tirlan FarmLife', 'Delivery Docket', 'Beef Finisher Nut 12% 2.00 t'), ctx, 't');
    expect(r.product?.value).toEqual({ text: 'Beef Finisher Nut 12%', feedProductId: null, name: null });
    expect(r.missing).toContain('feed');
  });
});
