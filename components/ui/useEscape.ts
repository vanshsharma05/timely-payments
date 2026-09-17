import { useEffect } from 'react';

/** Esc closes the dialog — every dialog, the same way — unless a save is in flight. */
export function useEscape(onClose: () => void, enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, enabled]);
}
