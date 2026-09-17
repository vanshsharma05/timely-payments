/**
 * Which search the app bar's one box edits on a given tab.
 *
 * The customer screens — Today, the book, Reports — share one term, so a
 * name typed on one is still there on the next (and Ctrl+K reaches it from
 * any of them). Live stock is a different list of different things, with
 * its own term: a customer name searched in the book must not empty the
 * stock list.
 */
export type SearchScope = 'customers' | 'stock';

export const searchScopeFor = (tab: string): SearchScope => (tab === 'stock' ? 'stock' : 'customers');
