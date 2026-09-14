import { useEffect, useState } from 'react';

/**
 * Whether this is a phone-sized window — the same line Tailwind's `md`
 * breakpoint draws, so a component can switch what it *renders* below it
 * (a row list instead of a table) while the stylesheet switches how things
 * *look*. The two must agree or a phone would get a table styled for a phone
 * and a laptop a list styled for a laptop.
 */
const PHONE_QUERY = '(max-width: 767px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(PHONE_QUERY);
    const apply = () => setPhone(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, []);
  return phone;
}
