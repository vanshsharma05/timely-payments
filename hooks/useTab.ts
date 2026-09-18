import { useState, useEffect } from 'react';

/**
 * The tab the app is on lives in the URL.
 *
 * It used to live only in React state, so every refresh dropped you back on
 * Today — mid-way through the customer book, or a report you had filtered down,
 * and you were on the dashboard again. In the address bar it survives a
 * refresh, and a link to a particular screen is a link somebody can send.
 */
export const TAB_KEYS = ['overview', 'customers', 'pdc', 'reports', 'stock', 'users', 'alerts', 'templates', 'source'];

export const tabFromLocation = (): string => {
    if (typeof window === 'undefined') return 'overview';
    const key = (window.location.hash || '').replace(/^#\/?/, '');
    return TAB_KEYS.includes(key) ? key : 'overview';
};

/**
 * One tab for the whole app, mirrored to the hash while somebody is signed
 * in. There used to be two (one for the company view, one for the personal
 * view) seeded, mirrored and reset identically — and a Manager, who reads
 * the company view, pressed "open in cheques" into the personal one and
 * went nowhere.
 */
export function useTab(active: boolean): [string, (key: string) => void] {
    const [tab, setTab] = useState(tabFromLocation);

    useEffect(() => {
        if (!active || typeof window === 'undefined') return;
        if (tabFromLocation() === tab) return;
        // replaceState, not push: tab changes are not journeys, and stacking one
        // history entry per click would make Back a way out of the app only
        // after a dozen presses.
        window.history.replaceState(null, '', `#${tab}`);
    }, [tab, active]);

    // Somebody editing the address bar, or arriving on a link, still lands on
    // the screen the URL names.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onHashChange = () => {
            const key = tabFromLocation();
            setTab(prev => (prev === key ? prev : key));
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);

    return [tab, setTab];
}

/**
 * The shortest window that can hold the Today page without hiding the work.
 *
 * Above the account list sit the app bar, the page title, the worklist cards
 * and (when there is one) the attention banner — about 510px of them. Below
 * that the list needs its own header and a few rows to be worth looking at.
 * On a 1366x768 laptop the viewport is roughly 640px, and holding that page to
 * one screen left the list two pixels tall with not one row visible: "Due
 * today: 2 accounts" and nothing under it.
 *
 * So the one-screen layout applies where it fits and the page scrolls where it
 * does not. A dashboard nobody can read is not a dashboard.
 */
const MIN_HEIGHT_FOR_ONE_SCREEN = 900;

/** Whether this window is tall enough for a page held to one screen. */
export function useFitsOneScreen(): boolean {
    const [fits, setFits] = useState(
        () => typeof window === 'undefined' || window.innerHeight >= MIN_HEIGHT_FOR_ONE_SCREEN,
    );
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => setFits(window.innerHeight >= MIN_HEIGHT_FOR_ONE_SCREEN);
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return fits;
}
