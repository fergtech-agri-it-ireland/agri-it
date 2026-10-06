// Copies the on-phone photo reader (Tesseract) into public/ocr/ so the app serves its
// own copies: no third-party CDN, and the service worker can cache them for offline
// reading. Runs before dev and build (see package.json). public/ocr/ is git-ignored.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const out = join('public', 'ocr');
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // The worker picks one of these per phone (relaxed SIMD, SIMD, or plain), LSTM engine only
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  // English, "best_int" model: accurate and about 3 MB gzipped
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz']
];
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install.`);
  copyFileSync(from, join(out, to));
}
console.log(`Photo reader files copied to ${out}`);
