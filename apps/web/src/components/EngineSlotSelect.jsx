/**
 * Engine slot picker — only disconnected/free slots are selectable.
 * Online FeedFlow sessions and slots held by other AMS accounts stay locked.
 */
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
    : Array.from({ length: 8 }, (_, i) => i);

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
        // Keep current selection choosable even if it just flipped online mid-flow.
        const isCurrent = value != null && Number(value) === Number(slotNum);
        const locked = (online && !isCurrent) || Boolean(taken);
        const name = eng?.label || taken || null;
        return (
          <option key={slotNum} value={slotNum} disabled={locked}>
            Slot {slotNum + 1}
            {name ? ` — ${name}` : ''}
            {online ? ' (online)' : !locked ? ' (free)' : ''}
          </option>
        );
      })}
    </select>
  );
}
