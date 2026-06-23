/**
 * Engine slot picker — disables slots already assigned to another account.
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
        return (
          <option key={slotNum} value={slotNum} disabled={Boolean(taken)}>
            Slot {slotNum + 1}
            {eng?.label ? ` — ${eng.label}` : ''}
            {eng?.connected ? ' (online)' : ''}
            {taken ? ` — ${taken}` : ''}
          </option>
        );
      })}
    </select>
  );
}
