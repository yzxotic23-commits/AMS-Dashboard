import { usePreparedQueue, countRegNeededFromQueue } from '../hooks/usePreparedQueue';

/** @deprecated use usePreparedQueue — kept for hub counts sync API */
export function countRegNeeded(site = 'all') {
  return 0;
}

export { usePreparedQueue, countRegNeededFromQueue };
