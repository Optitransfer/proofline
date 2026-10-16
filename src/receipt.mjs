// One receipt for a revision range. A missing daemon leaves the receipt unchanged.
import { receiptZeroConfig } from './infer.mjs';
import { attachMemory, probeDigest, receiptNote, writeReceiptNote } from './vault.mjs';

export async function buildReceipt(root, a = {}) {
  const receipt = receiptZeroConfig(root, { base: a.base });
  if (a.vault !== true) return receipt;
  const digest = await probeDigest();
  const attached = attachMemory(receipt, digest);
  const note = receiptNote({
    receipt: attached.receipt,
    role: typeof a.role === 'string' && a.role ? a.role : 'agent',
    subject: typeof a.task === 'string' ? a.task : '',
  });
  await writeReceiptNote(note, { vault: true });
  return attached.receipt;
}
