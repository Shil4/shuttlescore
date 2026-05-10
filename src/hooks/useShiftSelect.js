import { useRef, useCallback } from 'react';

/**
 * Hook for shift-click range selection in checklists.
 * 
 * Usage:
 *   const { handleClick } = useShiftSelect(selected, setSelected, items, getId);
 *   
 *   // In your checkbox/label onClick:
 *   onClick={(e) => handleClick(e, index)}
 *   
 * @param {Set} selected - current selected set (of IDs or indices)
 * @param {Function} setSelected - state setter for selected
 * @param {Array} items - the visible/ordered list of items
 * @param {Function} getKey - (item, index) => the key used in the selected Set (e.g. item.id or index)
 * @param {Function} isDisabled - (item, index) => true if this item can't be selected (optional)
 */
export function useShiftSelect(selected, setSelected, items, getKey, isDisabled) {
  const lastClickedRef = useRef(null);

  const handleClick = useCallback((e, index) => {
    const key = getKey(items[index], index);

    // Check if disabled
    if (isDisabled && isDisabled(items[index], index)) return;

    if (e.shiftKey && lastClickedRef.current !== null && lastClickedRef.current !== index) {
      // Range select
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);

      // Determine action: if the clicked item is not selected, we're adding; otherwise removing
      const adding = !selected.has(key);

      setSelected(prev => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (isDisabled && isDisabled(items[i], i)) continue;
          const k = getKey(items[i], i);
          if (adding) next.add(k);
          else next.delete(k);
        }
        return next;
      });
    } else {
      // Normal toggle
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    lastClickedRef.current = index;
  }, [selected, setSelected, items, getKey, isDisabled]);

  // Reset last clicked (call when list changes significantly)
  const resetLast = useCallback(() => { lastClickedRef.current = null; }, []);

  return { handleClick, resetLast };
}
