import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import {
  defaultGovernanceRange,
  fromDateInputValue,
  presetRange,
  toDateInputValue,
} from '../lib/governanceDateRange';

function startOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const GovernanceDateContext = createContext(null);

export function GovernanceDateProvider({ children }) {
  const initial = defaultGovernanceRange();
  const [preset, setPreset] = useState(initial.preset);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const applyPreset = useCallback((nextPreset) => {
    if (nextPreset === 'custom') {
      setPreset('custom');
      return;
    }
    const range = presetRange(nextPreset);
    if (!range) return;
    setPreset(nextPreset);
    setFrom(range.from);
    setTo(range.to);
  }, []);

  const setCustomRange = useCallback((fromInput, toInput) => {
    const fromDate = fromDateInputValue(fromInput);
    const toDate = fromDateInputValue(toInput);
    if (!fromDate || !toDate) return;
    const a = startOfDayLocal(fromDate);
    const b = endOfDayLocal(toDate);
    if (a.getTime() > b.getTime()) return;
    setPreset('custom');
    setFrom(a);
    setTo(b);
  }, []);

  const value = useMemo(() => ({
    preset,
    from,
    to,
    fromInput: toDateInputValue(from),
    toInput: toDateInputValue(to),
    applyPreset,
    setCustomRange,
  }), [preset, from, to, applyPreset, setCustomRange]);

  return (
    <GovernanceDateContext.Provider value={value}>
      {children}
    </GovernanceDateContext.Provider>
  );
}

export function useGovernanceDate() {
  const ctx = useContext(GovernanceDateContext);
  if (!ctx) throw new Error('useGovernanceDate must be used within GovernanceDateProvider');
  return ctx;
}

export function useOptionalGovernanceDate() {
  return useContext(GovernanceDateContext);
}
