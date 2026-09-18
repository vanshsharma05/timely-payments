/**
 * Final adversarial pass: the domain rules under odd input, pinned as they
 * behave today so a later change is a decision rather than an accident.
 * Garbage from a sheet becomes zero, not a crash; dates on either side of
 * midnight fall on the right side; a credit is not a debt; regex characters
 * in a search are just characters; and two accounts sharing a name are
 * treated as one company by a sync (the last wins, the other is settled).
 */
import { describe, it, expect } from 'vitest';
import { parseAmountAndType, parseGoogleSheetCsv, parseCSVMatrix, mergeWithExistingFollowUps } from '../services/googleSheetService';
import { parseExcelRows } from '../services/excel';
import { getFollowUpCategory, followUpStatusOf, hasOutstanding, chequeState, matchesSearch, FollowUpStatus, PdcStatus, Outstanding, PdcCheque } from '../types';
import { formatINR, formatCompact, relativeDays, dateFromLocalIso, startOfToday } from '../components/ui/format';
import { mixedAccount } from './fixtures';

const today = startOfToday();
const a = (over: Partial<Outstanding>): Outstanding => ({ ...mixedAccount(), followUpDate: undefined, status: FollowUpStatus.Pending, paymentRank: undefined, ...over });

describe('amounts from a sheet', () => {
    it('reads Indian grouping, a trailing Cr/Dr, brackets and a minus as a credit, and garbage as zero', () => {
        expect(parseAmountAndType('1,00,000')).toEqual({ amount: 100000, type: 'Dr' });
        expect(parseAmountAndType('1,00,000 Cr')).toEqual({ amount: 100000, type: 'Cr' });
        expect(parseAmountAndType('500Cr')).toEqual({ amount: 500, type: 'Cr' });
        expect(parseAmountAndType('-500')).toEqual({ amount: 500, type: 'Cr' });
        expect(parseAmountAndType('(500)')).toEqual({ amount: 500, type: 'Cr' });
        expect(parseAmountAndType('₹1,000')).toEqual({ amount: 1000, type: 'Dr' });
        for (const junk of ['', ' ', 'abc', '#REF!', '#N/A', 'NaN', null, undefined]) expect(parseAmountAndType(junk)).toEqual({ amount: 0, type: 'Dr' });
        expect(parseAmountAndType(-99)).toEqual({ amount: 99, type: 'Cr' });
    });
});

describe('a malformed sheet', () => {
    it('skips blank and #N/A names, keeps quoted commas, and does not throw on odd cells', () => {
        const csv = 'Company,Contact Person,Contact Number,Total Due,Ageing 1-45,Ageing 46-90,Ageing 91-135,Ageing >135,CRM\n' +
            ',,,\n#N/A,,,5,5,,,,\n"ODD, INC","Ram ""The"" Man",98x,abc,-5,,1e3,#REF!,#N/A\n"' + 'X'.repeat(600) + '",,,1,1,,,,\n';
        const r = parseGoogleSheetCsv(csv);
        expect(r.records.map(x => x.company.length)).toEqual([8, 600]);
        expect(r.records[0]).toMatchObject({ total: 0, totalType: 'Dr', crmOwnerId: '', contactNumber: '98x' });
        expect(parseCSVMatrix('"a,b","c""d"\n1,2')).toEqual([['a,b', 'c"d'], ['1', '2']]);
    });
    it('an Excel row of nothing becomes "Unknown Company" with zero — a row to notice in the review, not a crash', () => {
        const [row] = parseExcelRows([[undefined, '', undefined, 98765, 'abc', -5, '', '1e3', '#REF!', ' ankur ', undefined, 'not a date', 'n1, n2', 'yes', '2026-13-45']]);
        expect(row).toMatchObject({ id: 'row_1', company: 'Unknown Company', total: 0, crmOwnerId: 'ankur', notes: ['n1', 'n2'], isUrgent: false });
        expect(isNaN(new Date(row.followUpDate as Date).getTime())).toBe(true);
    });
});

describe('dates on either side of midnight', () => {
    const at = (offsetMs: number) => new Date(today.getTime() + offsetMs);
    const DAY = 86_400_000;
    it('a follow-up is "today" until the last millisecond, tomorrow from the first', () => {
        expect(getFollowUpCategory(a({ followUpDate: at(DAY - 1) }), today)).toBe('today');
        expect(getFollowUpCategory(a({ followUpDate: at(DAY + 1) }), today)).toBe('future');
        expect(getFollowUpCategory(a({ followUpDate: at(-1) }), today)).toBe('overdue');
        // a date stored at UTC midnight (what a date input saves) is still today east of Greenwich
        expect(getFollowUpCategory(a({ followUpDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z') }), today)).toBe('today');
    });
    it('an invalid date is no follow-up, not a crash; a collected account stays collected whatever its date', () => {
        expect(getFollowUpCategory(a({ followUpDate: new Date('nonsense') }), today)).toBe('no_follow_up');
        expect(followUpStatusOf(a({ followUpDate: new Date('nonsense') }), today)).toBe(FollowUpStatus.Pending);
        expect(getFollowUpCategory(a({ status: FollowUpStatus.Completed, followUpDate: new Date('2999-01-01') }), today)).toBe('completed');
        expect(relativeDays('nonsense')).toBeNull();
        expect(dateFromLocalIso('garbage')).toBeNull();
    });
    it('a cheque is due through the last millisecond of its day', () => {
        const cheque = (d: Date, status = PdcStatus.Pending): PdcCheque => ({ id: 'c', customerId: 'x', customerName: 'x', chequeNumber: '1', bankName: 'b', amount: 1, receivedDate: today, chequeDate: d, status });
        expect(chequeState(cheque(at(DAY - 1)), new Date())).toBe('due');
        expect(chequeState(cheque(at(DAY + 1)), new Date())).toBe('upcoming');
        expect(chequeState(cheque(new Date('2999-01-01'), PdcStatus.Cleared), new Date())).toBe('cleared');
    });
});

describe('balances', () => {
    it('zero is nothing to chase, a credit is on the books, NaN is nothing', () => {
        expect(hasOutstanding(a({ total: 0, ageing: { '1-45': 0, '46-90': 0, '91-135': 0, '>135': 0 } }))).toBe(false);
        expect(hasOutstanding(a({ total: 25000, totalType: 'Cr' }))).toBe(true);
        expect(hasOutstanding(a({ total: NaN as any }))).toBe(false);
        expect(formatINR(1e12)).toBe('₹10,00,00,00,00,000');
        expect(formatCompact(-5)).toBe('-₹5');
        expect(formatCompact(NaN)).toBe('₹0');
    });
});

describe('search', () => {
    it('treats regex characters as characters and never throws', () => {
        expect(matchesSearch(['abc (pvt) ltd'], '(')).toBe(true);
        expect(matchesSearch(['a\\b'], '\\')).toBe(true);
        expect(() => matchesSearch(['abc'], ')(')).not.toThrow();
        expect(matchesSearch(['abc'], 'a'.repeat(5000))).toBe(false);
        expect(matchesSearch(['abc'], '   ')).toBe(true);
    });
});

describe('two accounts with one name', () => {
    it('a sync treats them as one company: the later one takes the figures, the other is settled to zero', () => {
        const existing = [{ ...mixedAccount(), id: 'e1', company: 'ALPHA', total: 100 }, { ...mixedAccount(), id: 'e2', company: 'alpha ', total: 200 }];
        const incoming = [{ ...mixedAccount(), id: 'i1', company: 'Alpha', total: 300 }];
        const merged = mergeWithExistingFollowUps(existing, incoming);
        expect(merged.map(m => [m.id, m.total, !!m.settledAt])).toEqual([['e2', 300, false], ['e1', 0, true]]);
    });
});
