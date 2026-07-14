import { searchOffers } from '../../_lib/duffel.js';
import { applyCors } from '../../_lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { originIata, destinationIata, departureDate, passengerCount = 1 } = req.body;
    if (!originIata || !destinationIata || !departureDate) {
      return res.status(400).json({ success: false, error: 'originIata, destinationIata and departureDate are required' });
    }
    const passengers = Array.from({ length: passengerCount }, () => ({ type: 'adult' }));
    const result = await searchOffers({ originIata, destinationIata, departureDate, passengers });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Flight search error:', error.duffelResponse || error.message);
    res.status(500).json({ success: false, error: 'Failed to search flights' });
  }
}
