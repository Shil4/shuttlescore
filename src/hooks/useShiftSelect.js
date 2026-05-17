import { useRef, useCallback } from 'react';

/**
 * Hook for shift-click range selection in checklists.
 * 
 * Usage:
 *   const { handleClick } = useShiftSelect(selected, setSelected, items, getKey, isDisabled);
 *   
 *   // On the clickable element (div, label, etc):
 *   onClick={(e) => handleClick(e, index)}
 *   // On the checkbox itself:
 *   checked={selected.has(key)} readOnly
 */
export function useShiftSelect(setSelected, items, getKey, isDisabled) {
  const lastClickedRef = useRef(null);

  const handleClick = useCallback((e, index) => {
    // Prevent default label behavior (which would double-toggle the checkbox)
    e.preventDefault();

    if (!items[index]) return;
    const key = getKey(items[index], index);

    if (isDisabled && isDisabled(items[index], index)) return;

    if (e.shiftKey && lastClickedRef.current !== null && lastClickedRef.current !== index) {
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);

      setSelected(prev => {
        const next = new Set(prev);
        // Determine action based on current state of the clicked item
        const adding = !prev.has(key);
        for (let i = start; i <= end; i++) {
          if (!items[i]) continue;
          if (isDisabled && isDisabled(items[i], i)) continue;
          const k = getKey(items[i], i);
          if (adding) next.add(k);
          else next.delete(k);
        }
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    lastClickedRef.current = index;
  }, [setSelected, items, getKey, isDisabled]);

  const resetLast = useCallback(() => { lastClickedRef.current = null; }, []);

  return { handleClick, resetLast };
}