/**
 * Engine slot picker — FeedFlow connection is the source of truth.
 * Online/connected → locked. Disconnected → free (even if an old AMS name is sticky).
 * Offline fallback lists up to MAX_ENGINE_SLOT_FALLBACK slots (matches FeedFlow MAX_PAIRS×2).
 */
const MAX_ENGINE_SLOT_FALLBACK = 50;

export default function EngineSlotSelect({
  value,
  onChange,
  engineSlots = [],
  slotTakenBy = {},
  className = 'input text-sm',
  disabled = false,
  placeholder = '— Select slot —',
}) {
  const slotNumbers = engineSlots.length
    ? [...new Set(engineSlots.map((s) => s.slot))].sort((a, b) => a - b)
    : Array.from({ length: MAX_ENGINE_SLOT_FALLBACK }, (_, i) => i);

  return (
    <select
      className={className}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value === '' ? null : parseInt(e.target.value, 10));
      }}
    >
      <option value="">{placeholder}</option>
      {slotNumbers.map((slotNum) => {
        const taken = slotTakenBy[slotNum];
        const eng = engineSlots.find((s) => s.slot === slotNum);
        const online = Boolean(eng?.connected);
        const isCurrent = value != null && Number(value) === Number(slotNum);
        const locked = online && !isCurrent;
        // Only show occupant name while the session is actually online.
        const name = online ? (eng?.label || taken || null) : null;
        return (
          <option key={slotNum} value={slotNum} disabled={locked}>
            Slot {slotNum + 1}
            {name ? ` — ${name}` : ''}
            {online ? ' (online)' : ' (free)'}
          </option>
        );
      })}
    </select>
  );
}
