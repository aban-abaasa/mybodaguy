// A stand-in carrier for development and for running without a carrier account: it
// accepts the booking and invents a reference. Everything it produces is labelled
// provider 'mock', and the waybill and the QR page say it is a TEST booking — nothing
// real was booked with any shipping line.
import { randomBytes } from 'node:crypto';

export const mockCarrier = {
  id: 'mock',
  label: 'Test carrier (no real booking)',
  async createBooking(_request) {
    return {
      reference: `MOCK-${randomBytes(4).toString('hex').toUpperCase()}`,
      status: 'CONFIRMED',
      raw: { mock: true },
    };
  },
};
