import { useEffect, useRef } from 'react';

/** The dialogs open right now, innermost last; only the innermost answers the keyboard. */
const stack: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What every dialog owes the keyboard, in one place.
 *
 * Twelve dialogs each had their own shell, and between them: Tab walked out
 * of the dialog into the page behind it, Esc closed some and not others,
 * focus landed wherever the browser left it, and on close it went nowhere.
 * Attach the ref to the dialog's panel and it: takes focus on open (the
 * element marked `data-autofocus`, else the first control), keeps Tab and
 * Shift+Tab inside, closes on Esc unless told not to (a save in flight, or a
 * dialog with its own key handling), and hands focus back to whatever opened
 * it. Stacked dialogs take turns: the innermost one answers.
 *
 * The panel should also carry role="dialog" (or "alertdialog"),
 * aria-modal="true" and aria-labelledby pointing at its title — the hook
 * sets tabindex so the panel itself can hold focus when nothing else can.
 */
export function useModal<T extends HTMLElement = HTMLDivElement>(
    active: boolean,
    onClose?: () => void,
    opts: { closeOnEscape?: boolean } = {},
) {
    const ref = useRef<T>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const escRef = useRef(opts.closeOnEscape !== false);
    escRef.current = opts.closeOnEscape !== false;

    useEffect(() => {
        if (!active) return;
        const root = ref.current;
        if (!root) return;
        const opener = document.activeElement as HTMLElement | null;
        stack.push(root);
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');

        // A hidden control is not a stop. Without layout (a test runner) every
        // size is zero, so the size test only applies where sizes exist.
        const hasLayout = document.body.offsetWidth > 0;
        const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
            .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true')
            .filter(el => !hasLayout || el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

        // Initial focus: what the dialog asked for, else its first control, else the panel.
        if (!root.contains(document.activeElement)) {
            const wanted = root.querySelector<HTMLElement>('[data-autofocus], [autofocus]');
            (wanted || focusables()[0] || root).focus({ preventScroll: true });
        }

        const onKey = (e: KeyboardEvent) => {
            if (stack[stack.length - 1] !== root) return;
            if (e.key === 'Escape') {
                if (escRef.current && closeRef.current) { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
                return;
            }
            if (e.key !== 'Tab') return;
            const list = focusables();
            if (list.length === 0) { e.preventDefault(); root.focus(); return; }
            const first = list[0], last = list[list.length - 1];
            const current = document.activeElement as HTMLElement | null;
            const inside = !!current && root.contains(current);
            if (e.shiftKey) {
                if (!inside || current === first) { e.preventDefault(); last.focus(); }
            } else if (!inside || current === last) {
                e.preventDefault(); first.focus();
            }
        };
        // A click outside cannot move focus out either: bring it back.
        const onFocusIn = (e: FocusEvent) => {
            if (stack[stack.length - 1] !== root) return;
            const t = e.target as HTMLElement | null;
            if (t && !root.contains(t)) (focusables()[0] || root).focus({ preventScroll: true });
        };
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('focusin', onFocusIn, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            document.removeEventListener('focusin', onFocusIn, true);
            const i = stack.lastIndexOf(root);
            if (i >= 0) stack.splice(i, 1);
            if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        };
    }, [active]);

    return ref;
}
