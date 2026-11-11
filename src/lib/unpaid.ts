/**
 * sessionStorage key for the booking order the customer was just sent to pay. If they come
 * back to the booking page without paying, that order is cancelled so its PCs are free again.
 */
export const UNPAID_ORDER_KEY = 'booking.unpaidOrder';
