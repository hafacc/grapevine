import { offerMemory } from "./offer-memory";

// Whether a just-joined account is still to be offered the prefilled accounts:
// once per account on a device, after it accepts a link, since only then can
// it follow one.
const memory = offerMemory("grapevine:prefilled-offer:");

export const prefilledOfferWaiting = memory.waiting;
export const setPrefilledOffer = memory.set;
export const forgetPrefilledOffers = memory.forget;
