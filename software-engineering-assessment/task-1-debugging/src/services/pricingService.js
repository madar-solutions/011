import { enumerateNights } from '../lib/dates.js';
import { percentOf } from '../lib/money.js';
import { notFound, unprocessable, badRequest } from '../lib/errors.js';
import * as rateRepo from '../repositories/rateRepo.js';
import * as roomTypeRepo from '../repositories/roomTypeRepo.js';

export const CITY_TAX_PERCENT = 12;
export const RESORT_FEE_CENTS = 1500;

/** A season row covers a night when start_date <= night < end_date (SPEC.md 3). */
function covers(season, date) {
  return season.start_date <= date && date < season.end_date;
}

/**
 * Returns one priced night per night of the stay, [checkIn, checkOut).
 *
 * The stay decides which nights exist; the rate calendar only decides what each of
 * them costs. Iterating the other way round — walking the seasons and clipping them
 * to the stay — is what caused incident 2291: it let the shape of a hand-maintained
 * table determine how many nights a guest was billed for, so adjoining seasons billed
 * their shared boundary date twice and gaps billed nights zero times.
 *
 * This function is total: every night of the stay gets exactly one rate, or the stay
 * is refused. SPEC.md 3 is explicit that revenue management prefers refusing a booking
 * over pricing it wrongly, so a night that no season covers — or that two seasons
 * cover, which would make the price ambiguous — is a business rejection, never a
 * silently shorter bill and never an invented rate.
 */
export function resolveNightlyRates(roomTypeId, checkIn, checkOut) {
  const roomType = roomTypeRepo.findById(roomTypeId);
  if (!roomType) {
    throw notFound('ROOM_TYPE_NOT_FOUND', `Unknown room type ${roomTypeId}`);
  }

  const stay = enumerateNights(checkIn, checkOut);
  if (stay.length === 0) {
    throw badRequest('INVALID_INPUT', 'checkOut must be after checkIn', { checkIn, checkOut });
  }

  const seasons = rateRepo.findSeasons(roomTypeId, checkIn, checkOut);
  const nights = [];
  const unpriced = [];
  const ambiguous = [];

  for (const date of stay) {
    const covering = seasons.filter((season) => covers(season, date));
    if (covering.length === 0) unpriced.push(date);
    else if (covering.length > 1) ambiguous.push(date);
    else nights.push({ date, season: covering[0].season, rateCents: covering[0].nightly_rate_cents });
  }

  if (unpriced.length > 0 || ambiguous.length > 0) {
    throw unprocessable(
      'RATE_UNAVAILABLE',
      `No single nightly rate is defined for every night of this stay in ${roomType.name}`,
      {
        roomTypeId,
        checkIn,
        checkOut,
        ...(unpriced.length > 0 && { unpricedNights: unpriced }),
        ...(ambiguous.length > 0 && { ambiguouslyPricedNights: ambiguous })
      }
    );
  }

  return nights;
}

export function quote(roomTypeId, checkIn, checkOut) {
  const nights = resolveNightlyRates(roomTypeId, checkIn, checkOut);
  const roomCents = nights.reduce((sum, n) => sum + n.rateCents, 0);
  const taxCents = percentOf(roomCents, CITY_TAX_PERCENT);
  const feeCents = RESORT_FEE_CENTS;
  return { nights, roomCents, taxCents, feeCents, totalCents: roomCents + taxCents + feeCents };
}

export function toFolioLines(quoted) {
  return [
    ...quoted.nights.map((n) => ({
      date: n.date,
      kind: 'room',
      description: `Room charge (${n.season})`,
      amountCents: n.rateCents
    })),
    { date: null, kind: 'tax', description: `City tax ${CITY_TAX_PERCENT}%`, amountCents: quoted.taxCents },
    { date: null, kind: 'fee', description: 'Resort fee', amountCents: quoted.feeCents }
  ];
}
