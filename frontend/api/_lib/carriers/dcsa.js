// Builds a DCSA Booking 2.0 request for the sea leg of a paid cargo journey.
//
// DCSA (Digital Container Shipping Association) publishes one booking format that
// Maersk, Hapag-Lloyd, CMA CGM, MSC, ONE, Evergreen, Yang Ming, HMM and ZIM align to,
// so this one builder serves every carrier adapter. The field mapping below follows
// the DCSA Booking 2.0 OpenAPI; a carrier can still reject or require extra fields
// (service contract, party codes), so it is validated against that carrier's sandbox
// before anything is relied on — see README.md in this folder.

/** One 20ft container (ISO 22G1) carries about this much cargo. */
export const CONTAINER_PAYLOAD_KG = 26000;
/** Below this weight the cargo goes as less-than-container-load instead of its own container. */
export const LCL_BELOW_KG = 2000;
/** How soon the cargo can be at the departure port (road leg + handling). */
const READY_IN_DAYS = 7;

export class CarrierRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CarrierRequestError';
  }
}

const dateOnly = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} p
 * @param {{ id: string, cargo_description?: string, cargo_weight_kg?: number }} p.journey
 * @param {{ port_name: string, city: string, un_locode: string }} p.originPort   Port of loading
 * @param {{ port_name: string, city: string, un_locode: string }} p.destinationPort  Port of discharge
 * @param {Date} [p.now]
 */
export function buildDcsaBookingRequest({ journey, originPort, destinationPort, now = new Date() }) {
  const weightKg = Number(journey.cargo_weight_kg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new CarrierRequestError('The cargo has no weight, so a container cannot be booked.');
  }
  for (const [label, port] of [['departure', originPort], ['arrival', destinationPort]]) {
    if (!port?.un_locode) throw new CarrierRequestError(`The ${label} port has no UN/LOCODE yet — set mbg_ports.un_locode for it.`);
  }

  const lcl = weightKg < LCL_BELOW_KG;
  const containers = Math.max(1, Math.ceil(weightKg / CONTAINER_PAYLOAD_KG));
  const description = String(journey.cargo_description || 'General cargo').trim().slice(0, 100);
  const ready = new Date(now.getTime() + READY_IN_DAYS * 24 * 60 * 60 * 1000);

  return {
    receiptTypeAtOrigin: lcl ? 'CFS' : 'CY',
    deliveryTypeAtDestination: lcl ? 'CFS' : 'CY',
    cargoMovementTypeAtOrigin: lcl ? 'LCL' : 'FCL',
    cargoMovementTypeAtDestination: lcl ? 'LCL' : 'FCL',
    communicationChannelCode: 'AO', // API
    isEquipmentSubstitutionAllowed: false,
    isExportDeclarationRequired: false,
    isImportLicenseRequired: false,
    expectedDepartureDate: dateOnly(ready),
    shipmentLocations: [
      { locationTypeCode: 'POL', location: { locationName: originPort.port_name, UNLocationCode: originPort.un_locode } },
      { locationTypeCode: 'POD', location: { locationName: destinationPort.port_name, UNLocationCode: destinationPort.un_locode } },
    ],
    ...(lcl ? {} : {
      requestedEquipments: [{
        ISOEquipmentCode: '22G1',
        units: containers,
        isShipperOwned: false,
        commodities: [{ commodityType: description, cargoGrossWeight: { value: weightKg, unit: 'KGM' } }],
      }],
    }),
    // Our own reference, so the carrier's booking can be matched back to the waybill.
    externalReference: `BGE-${String(journey.id).slice(0, 8).toUpperCase()}`,
  };
}

/** Reads the reference and status out of a DCSA booking response. */
export function parseDcsaBookingResponse(body) {
  const reference = body?.carrierBookingRequestReference || body?.carrierBookingReference || null;
  const status = body?.bookingStatus || body?.documentStatus || 'RECEIVED';
  return { reference: reference ? String(reference) : null, status: String(status) };
}
