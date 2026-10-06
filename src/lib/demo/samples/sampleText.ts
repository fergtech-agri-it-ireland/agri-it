/**
 * What the on-phone reader (Tesseract, eng best_int) found on each demo sample photo.
 * Used by the unit tests, and by the demo when live reading cannot load in the page.
 * Regenerate after changing scripts/samples/make_dockets.py.
 */
import type { OcrLine } from '../../docket/extract';

export const SAMPLE_TEXT: Record<string, OcrLine[]> = {
  'feed-docket.jpg': [
    {text: "Tirlan FarmLife", confidence: 83},
    {text: "Bulk Feed Delivery Docket", confidence: 96},
    {text: "Docket No: D-482917", confidence: 93},
    {text: "Date: 05/10/2026", confidence: 96},
    {text: "Customer: Glenview Farm, Co. Tipperary", confidence: 96},
    {text: "Account: 104477", confidence: 95},
    {text: "Product Qty Unit", confidence: 95},
    {text: "DAIRY NUT 16% CP 3.00 j §", confidence: 72},
    {text: "Price per tonne 392.00", confidence: 96},
    {text: "Value EUR 1,176.00", confidence: 92},
    {text: "Haulier: J. Ryan Reg: 191-T-2214", confidence: 92},
    {text: "Received by:", confidence: 96},
    {text: "SAMPLE FOR AGRI-IT DEMO. NOT A REAL DOCUMENT.", confidence: 95},
  ],
  'supplier-invoice.jpg': [
    {text: "Dairygold Agri Business", confidence: 94},
    {text: "Sales Invoice", confidence: 95},
    {text: "Invoice No: INV-2026-118834", confidence: 93},
    {text: "Invoice Date: 29/09/2026", confidence: 95},
    {text: "Account: GLV-2231 Glenview Farm", confidence: 94},
    {text: "Description Qty Rate Amount", confidence: 94},
    {text: "Dairy Nut 16% Bulk 2.50t 388.00 970.00", confidence: 94},
    {text: "Net 970.00", confidence: 96},
    {text: "VAT 0% 0.00", confidence: 96},
    {text: "Total due EUR 970.00", confidence: 96},
    {text: "Payment due within 30 days.", confidence: 95},
    {text: "SAMPLE FOR AGRI-IT DEMO. NOT A REAL DOCUMENT.", confidence: 94},
  ],
  'vet-receipt.jpg': [
    {text: "Suir Valley Veterinary Clinic", confidence: 96},
    {text: "Main St, Cahir, Co. Tipperary", confidence: 95},
    {text: "RECEIPT", confidence: 96},
    {text: "Invoice No: 20871", confidence: 96},
    {text: "Date: 02/10/2026", confidence: 96},
    {text: "Client: Glenview Farm", confidence: 96},
    {text: "Call-out fee 45.00", confidence: 94},
    {text: "Calving assistance 95.00", confidence: 96},
    {text: "Medicines 38.50", confidence: 96},
    {text: "Subtotal 178.50", confidence: 96},
    {text: "VAT @ 13.5% 24.10", confidence: 94},
    {text: "TOTAL EUR 202.60", confidence: 95},
    {text: "Paid by card. Thank you.", confidence: 96},
    {text: "SAMPLE FOR AGRI-IT DEMO. NOT A REAL DOCUMENT.", confidence: 95},
  ],
};
