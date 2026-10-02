# Carrier bookings

Books the sea leg of a paid cargo journey with a shipping line and stores the carrier's
booking reference on the leg, so the waybill and its QR page can show it.

- `dcsa.js` builds a **DCSA Booking 2.0** request — one format Maersk, Hapag-Lloyd,
  CMA CGM, MSC, ONE and others align to. The mapping was written from the DCSA spec
  without access to a carrier sandbox: **run it against the carrier's sandbox/mock and
  adjust before relying on it** (carriers can require extra fields such as a service
  contract or party details).
- `maersk.js` is the Maersk adapter (credentials + transport only).
- `mock.js` is a test carrier. It books nothing real; refs look like `MOCK-1A2B3C4D` and the
  ticket says "TEST booking".
- `index.js` picks the carrier from `CARRIER_PROVIDER` (`mock` | `maersk`, default `mock`).

## Environment (server)

| Variable | Meaning |
|---|---|
| `CARRIER_PROVIDER` | `mock` (default) or `maersk` |
| `CRON_SECRET` | shared secret for the `x-cron-secret` header on the booking endpoint |
| `MAERSK_BOOKING_URL` | full URL of Maersk's create-booking endpoint (sandbox URL while testing) |
| `MAERSK_CONSUMER_KEY` | your Maersk app's API key (`Consumer-Key` header) |
| `MAERSK_TOKEN_URL`, `MAERSK_CLIENT_ID`, `MAERSK_CLIENT_SECRET` | only if the booking API needs an OAuth bearer token |

## Use

```
curl -X POST https://<site>/api/journeys/carrier-booking \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"journeyId":"<uuid>","dryRun":true}'      # shows the request, books nothing
```

Drop `dryRun` to book. A booking is never retried automatically: a timeout leaves the leg
`unconfirmed` for a person to check at the carrier; a clear refusal leaves it `failed` and can be retried.
