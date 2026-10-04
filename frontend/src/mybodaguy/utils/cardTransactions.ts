// Rider ID card payments live in the shared wallet ledger as ordinary rows (the
// rider's debit is a 'journey_payment', each chairperson's share is an 'earn'),
// tagged with the reference "rider_card:<card id>". The ledger's transaction types
// are a fixed list shared with other apps, so the wallet recognises card payments
// by that reference and names them properly instead.

type CardTxLike = { reference_id: string | null; direction: 'in' | 'out' };

export const isRiderCardTx = (tx: Pick<CardTxLike, 'reference_id'>) =>
  !!tx.reference_id && tx.reference_id.startsWith('rider_card:');

export const riderCardTxLabel = (tx: CardTxLike) =>
  tx.direction === 'out' ? 'Rider ID card' : 'Card fee share';

// The rider's own debit note is fixed by the shared debit function ("Paid 2 ICAN
// for journey…"), so say what it really was.
export const riderCardTxNote = (tx: CardTxLike & { note: string | null }) =>
  tx.direction === 'out'
    ? 'Rider ID card fee, shared with your stage, parish, subcounty, division and district chairpersons'
    : tx.note;
