/**
 * Refreshing a long-open tab (services/refresh.ts): the server's rows win,
 * except anything this tab has changed and not yet saved.
 */
import { describe, it, expect } from 'vitest';
import { mergeServerRows } from '../services/refresh';
import { Outstanding } from '../types';
import { mixedAccount } from './fixtures';

const acc = (id: string, over: Partial<Outstanding> = {}): Outstanding => ({ ...mixedAccount(), id, company: id.toUpperCase(), ...over });

describe('mergeServerRows', () => {
    const local = [
        acc('a', { notes: ['my unsaved note'] }),          // pending here
        acc('b'),                                          // untouched here, changed elsewhere
        acc('c'),                                          // deleted elsewhere
        acc('d', { company: 'NEW HERE' }),                 // created here, not yet accepted
    ];
    const server = [
        acc('a', { notes: ['a colleague\'s note'] }),
        acc('b', { crmOwnerId: 'PRIKSHIT' }),
        acc('e', { company: 'ADDED ELSEWHERE' }),
    ];
    const r = mergeServerRows(local, server, ['a', 'd']);

    it('keeps this tab\'s unsaved row exactly, takes the server\'s version of everything else', () => {
        const byId = new Map(r.merged.map(x => [x.id, x]));
        expect(byId.get('a')!.notes).toEqual(['my unsaved note']);
        expect(byId.get('b')!.crmOwnerId).toBe('PRIKSHIT');
        expect(byId.has('e')).toBe(true);
    });

    it('drops a row deleted elsewhere unless it is pending here; keeps a row created here', () => {
        expect(r.merged.map(x => x.id).sort()).toEqual(['a', 'b', 'd', 'e']);
        expect(r.dropped).toEqual(['c']);
    });

    it('hands back exactly the server rows the baseline may move to — never the pending one', () => {
        expect(r.accepted.map(x => x.id).sort()).toEqual(['b', 'e']);
    });

    it('with nothing pending, the result is simply the server\'s book', () => {
        const plain = mergeServerRows(local, server, []);
        expect(plain.merged).toEqual(server);
        expect(plain.dropped.sort()).toEqual(['c', 'd']);
        expect(plain.accepted).toEqual(server);
    });

    it('an empty server read leaves only what is pending (and drops the rest as gone)', () => {
        const empty = mergeServerRows(local, [], ['d']);
        expect(empty.merged.map(x => x.id)).toEqual(['d']);
        expect(empty.dropped.sort()).toEqual(['a', 'b', 'c']);
    });
});
