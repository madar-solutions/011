import * as availabilityRepo from '../repositories/availabilityRepo.js';
import * as reservationRepo from '../repositories/reservationRepo.js';
import * as roomTypeRepo from '../repositories/roomTypeRepo.js';
import { quote, toFolioLines } from './pricingService.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';

function requireRoomType(roomTypeId) {
  const type = roomTypeRepo.findById(roomTypeId);
  if (!type) throw notFound('ROOM_TYPE_NOT_FOUND', `Unknown room type ${roomTypeId}`);
  return type;
}

/** SPEC.md 2: the party may not exceed the room type's capacity. */
function assertCapacity(type, guests) {
  if (guests > type.capacity) {
    throw unprocessable('GUESTS_EXCEED_CAPACITY', `${type.name} sleeps at most ${type.capacity} guests`, {
      roomTypeId: type.id,
      guests,
      capacity: type.capacity
    });
  }
}

/**
 * The house rule: a room type is sold out for a range when the number of confirmed
 * reservations overlapping that range has reached the number of physical rooms.
 *
 * "Overlapping" is defined once, in availabilityRepo, and this is the same call
 * /availability makes. This service used to answer the question itself with a second
 * implementation, which is how the two surfaces came to disagree (incident 2304).
 */
function assertRoomsLeft(type, checkIn, checkOut, { excludeReservationId } = {}) {
  const booked = availabilityRepo.countOverlapping(type.id, checkIn, checkOut, { excludeReservationId });

  if (booked >= type.total_rooms) {
    throw conflict('NO_ROOMS_AVAILABLE', `${type.name} is sold out for the requested dates`, {
      roomTypeId: type.id,
      checkIn,
      checkOut
    });
  }
}

export function create({ guestName, roomTypeId, checkIn, checkOut, guests, policyId }) {
  const type = requireRoomType(roomTypeId);
  // Capacity is a property of the request itself, so it is checked before occupancy:
  // three guests never fit a Standard Twin, however many of them are free.
  assertCapacity(type, guests);
  assertRoomsLeft(type, checkIn, checkOut);

  const quoted = quote(roomTypeId, checkIn, checkOut);
  const reservation = reservationRepo.insert({
    id: reservationRepo.nextId(),
    guest_name: guestName,
    room_type_id: roomTypeId,
    check_in: checkIn,
    check_out: checkOut,
    guests,
    status: 'confirmed',
    policy_id: policyId ?? 'FLEX',
    created_at: new Date().toISOString()
  });

  reservationRepo.replaceFolio(reservation.id, toFolioLines(quoted));
  return reservation;
}

export function changeDates(id, checkIn, checkOut) {
  const reservation = reservationRepo.findById(id);
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND', `Unknown reservation ${id}`);
  if (reservation.status !== 'confirmed') {
    throw conflict('RESERVATION_NOT_CONFIRMED', `Reservation ${id} is ${reservation.status}`);
  }

  // The reservation being moved must not be counted against itself.
  assertRoomsLeft(requireRoomType(reservation.room_type_id), checkIn, checkOut, { excludeReservationId: id });

  const quoted = quote(reservation.room_type_id, checkIn, checkOut);
  const updated = reservationRepo.updateDates(id, checkIn, checkOut);
  reservationRepo.replaceFolio(id, toFolioLines(quoted));
  return updated;
}

export function get(id) {
  const reservation = reservationRepo.findById(id);
  if (!reservation) throw notFound('RESERVATION_NOT_FOUND', `Unknown reservation ${id}`);
  return reservation;
}
