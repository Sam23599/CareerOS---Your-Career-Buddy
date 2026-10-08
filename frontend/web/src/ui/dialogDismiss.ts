import { useRef, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';

/** Close only when both the press and click are outside the dialog's content. */
export function useDialogDismiss(close: () => void) {
  const pressedBackdrop = useRef(false);
  function outside(event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  return {
    onCancel(event: SyntheticEvent<HTMLDialogElement>) { event.preventDefault(); close(); },
    onPointerDown(event: PointerEvent<HTMLDialogElement>) { pressedBackdrop.current = event.button === 0 && outside(event); },
    onPointerCancel() { pressedBackdrop.current = false; },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = pressedBackdrop.current && outside(event);
      pressedBackdrop.current = false;
      if (dismiss) close();
    },
  };
}
