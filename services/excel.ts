/**
 * SheetJS on demand.
 *
 * The library is half a megabyte minified and was preloaded for everyone at
 * sign-in, though only an export or an upload ever uses it. Importing it here,
 * when the button is pressed, keeps it out of the first load; the browser
 * fetches the chunk once and keeps it.
 */
export const loadXlsx = () => import('xlsx');
export type Xlsx = Awaited<ReturnType<typeof loadXlsx>>;
