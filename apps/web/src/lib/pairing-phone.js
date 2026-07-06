/** Normalize phone for WhatsApp pairing (digits only, country code). */
export function normalizePairingPhone(phoneNumber) {
  let p = String(phoneNumber || '').replace(/\D/g, '');
  if (!p) return p;
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('62')) {
    const local = p.slice(2).replace(/^0+/, '');
    if (local.length >= 9) return `62${local}`;
  }
  if (p.startsWith('60')) {
    const local = p.slice(2).replace(/^0+/, '');
    if (local.length >= 8) return `60${local}`;
  }
  if (p.startsWith('855')) {
    const local = p.slice(3).replace(/^0+/, '');
    if (local.length >= 8) return `855${local}`;
  }
  const m = p.match(
    /^(1\d{2}|2\d{1,2}|3\d{2}|4\d{2}|5\d{2}|6\d{1,2}|7\d{1,2}|8\d{2}|9\d{1,2})(0+)(\d{6,})$/,
  );
  if (m) p = m[1] + m[3];
  return p;
}
