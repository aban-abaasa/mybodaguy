import { toast } from 'sonner';
import { ICANERA_WALLET_URL, type PayoutError } from '../services/icanWalletService';

/** Show a failed payout; when the payout was refused, offer a button straight to the IcanEra wallet. */
export function showPayoutError(error: PayoutError, fallback = 'Payout failed') {
  toast.error(error?.message || fallback, error?.suggestIcanEra
    ? {
        duration: 12000,
        action: {
          label: 'Open IcanEra Wallet',
          onClick: () => window.open(error.icanEraWalletUrl || ICANERA_WALLET_URL, '_blank', 'noopener'),
        },
      }
    : undefined);
}
