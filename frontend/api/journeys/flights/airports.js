import { searchPlaceSuggestions } from '../../_lib/duffel.js';
import { applyCors } from '../../_lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { query, countryCode } = req.body;
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'query must be at least 2 characters' });
    }
    const { data } = await searchPlaceSuggestions({ query });
    const airports = (data || [])
      .filter((p) => p.type === 'airport' && (!countryCode || p.iata_country_code === countryCode))
      .map((p) => ({
        iataCode: p.iata_code,
        name: p.name,
        cityName: p.city_name || null,
        countryCode: p.iata_country_code,
      }));
    res.status(200).json({ success: true, airports });
  } catch (error) {
    console.error('Airport suggestion error:', error.duffelResponse || error.message);
    res.status(500).json({ success: false, error: 'Failed to look up airports' });
  }
}
