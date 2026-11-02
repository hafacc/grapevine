import { offerMemory } from "./offer-memory";

// Whether a just-joined account is still to be asked about importing: once
// per account on a device, after it accepts a link.
const memory = offerMemory("grapevine:import-offer:");

export const importOfferWaiting = memory.waiting;
export const setImportOffer = memory.set;
export const forgetImportOffers = memory.forget;
