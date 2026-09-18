/**
 * The figures on Today, computed from the book.
 *
 * Pure functions of the rows and the day: App.tsx memoises them, the tests
 * pin them. They used to live inline in App.tsx as eight useMemo blocks,
 * two of them (the ageing totals and the four worklist boxes) written out
 * twice — once for the whole book and once for one person's slice.
 */
import {
    Outstanding, User, UserRole, FollowUpStatus, PdcCheque,
    getFollowUpCategory, followUpStatusOf, hasOutstanding, isBadDebt, matchesSearch,
    ownerKey, scopeTo, seesWholeBook, isResponsibleFor, chequeState, CHEQUE_ACTIVE,
} from '../types';
import type { FollowUpCategoryFilter } from '../components/ReportsView';

/* --------------------------------- ageing --------------------------------- */

export interface AgeingTotals {
    a1: number; a2: number; a3: number; a4: number;
    total: number; over45: number; over90: number;
    pct45: number; pct90: number;
}

/**
 * Ageing across a set of accounts. Credit balances are excluded: money
 * sitting with us is not a receivable and must not inflate the outstanding
 * figure.
 */
export function ageingTotals(rows: Outstanding[]): AgeingTotals {
    let a1 = 0, a2 = 0, a3 = 0, a4 = 0;
    rows.forEach(item => {
        if (item.totalType === 'Cr') return;
        const t = item.ageingTypes || {};
        if (t['1-45'] !== 'Cr') a1 += Math.abs(item.ageing?.['1-45'] || 0);
        if (t['46-90'] !== 'Cr') a2 += Math.abs(item.ageing?.['46-90'] || 0);
        if (t['91-135'] !== 'Cr') a3 += Math.abs(item.ageing?.['91-135'] || 0);
        if (t['>135'] !== 'Cr') a4 += Math.abs(item.ageing?.['>135'] || 0);
    });
    const total = a1 + a2 + a3 + a4;
    const over45 = a2 + a3 + a4;
    const over90 = a3 + a4;
    return {
        a1, a2, a3, a4, total, over45, over90,
        pct45: total > 0 ? Math.round((over45 / total) * 100) : 0,
        pct90: total > 0 ? Math.round((over90 / total) * 100) : 0,
    };
}

/* -------------------------------- worklist -------------------------------- */

export interface WorklistSummary {
    todayCount: number; todayAmount: number;
    overdueCount: number; overdueAmount: number;
    noFollowUpCount: number; noFollowUpAmount: number;
    futureCount: number; futureAmount: number;
    badDebtCount: number; badDebtAmount: number;
    /** Accounts with dues, defaulters included. */
    totalCount: number; totalAmount: number;
}

/**
 * The four worklist boxes and the bad-debt strip.
 *
 * Customers who owe nothing are not work: left in, the whole Customer
 * Master lands in "No follow-up" and swamps the box. Defaulters are
 * counted on their own card, not in the worklist, but stay in the total.
 */
export function worklistSummary(rows: Outstanding[], today: Date): WorklistSummary {
    let todayCount = 0, todayAmount = 0;
    let overdueCount = 0, overdueAmount = 0;
    let noFollowUpCount = 0, noFollowUpAmount = 0;
    let futureCount = 0, futureAmount = 0;
    let badDebtCount = 0, badDebtAmount = 0;
    let totalCount = 0, totalAmount = 0;

    rows.forEach(item => {
        if (!hasOutstanding(item)) return;

        totalCount++;
        totalAmount += item.total || 0;
        if (isBadDebt(item)) {
            badDebtCount++;
            badDebtAmount += item.total || 0;
            return;
        }

        const cat = getFollowUpCategory(item, today);
        if (cat === 'completed') return;

        if (cat === 'today') {
            todayCount++;
            todayAmount += item.total || 0;
        } else if (cat === 'overdue') {
            overdueCount++;
            overdueAmount += item.total || 0;
        } else if (cat === 'future') {
            futureCount++;
            futureAmount += item.total || 0;
        } else if (cat === 'no_follow_up') {
            noFollowUpCount++;
            noFollowUpAmount += item.total || 0;
        }
    });

    return {
        todayCount, todayAmount,
        overdueCount, overdueAmount,
        noFollowUpCount, noFollowUpAmount,
        futureCount, futureAmount,
        badDebtCount, badDebtAmount,
        totalCount, totalAmount,
    };
}

export interface WorklistFilters {
    searchTerm: string;
    statusFilter: FollowUpStatus | null;
    categoryFilter: FollowUpCategoryFilter;
    priorityFilter: boolean;
    unattendedFilter: boolean;
}

/**
 * The personal Today list: this person's accounts, narrowed by the card
 * pressed, the attention banner, or a search.
 *
 * Nothing owed is nothing to chase — the four boxes count it that way, so
 * the list they open has to agree. Two exceptions: an account collected
 * today belongs in "collected" precisely because it now owes nothing, and a
 * search is a search — looking a customer up by name must find them, paid
 * or not. A defaulter is on the recovery list and nowhere else in the
 * worklist, unless somebody is searching.
 */
export function filterWorklist(rows: Outstanding[], f: WorklistFilters, users: User[], today: Date): Outstanding[] {
    const { searchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter } = f;
    const searching = Boolean(searchTerm.trim());
    return rows.filter(item => {
        const itemCategory = getFollowUpCategory(item, today);

        if (!hasOutstanding(item) && itemCategory !== 'completed' && !searching) return false;

        if (categoryFilter === 'bad_debt') return isBadDebt(item);
        if (isBadDebt(item) && !searching) return false;

        if (priorityFilter) {
            return (item.isUrgent && itemCategory !== 'completed') || itemCategory === 'overdue';
        }

        if (unattendedFilter) {
            // Unattended: Overdue OR No Follow-up
            return itemCategory === 'overdue' || itemCategory === 'no_follow_up';
        }

        if (categoryFilter !== 'all') {
            if (itemCategory !== categoryFilter) return false;
        }

        if (!statusFilter) return true;

        if (statusFilter === FollowUpStatus.Completed) {
            if (!item.followUpDate) return false;
            const collectedDate = new Date(item.followUpDate);
            collectedDate.setHours(0, 0, 0, 0);
            return item.status === FollowUpStatus.Completed && collectedDate.getTime() === today.getTime();
        }

        return followUpStatusOf(item, today) === statusFilter;
    }).filter(item => {
        if (!searchTerm.trim()) return true;
        const userObj = users.find(u => u.id === item.crmOwnerId || u.name === item.crmOwnerId);
        const crmDisplayName = userObj ? userObj.name.toLowerCase() : '';
        const collectorObj = users.find(u => u.id === item.assignedCollectorId || u.name === item.assignedCollectorId);
        const collectorDisplayName = collectorObj ? collectorObj.name.toLowerCase() : '';

        const company = String(item.company || '').toLowerCase();
        const contactPerson = String(item.contactPerson || '').toLowerCase();
        const contactPhone = String(item.contactNumber || '').toLowerCase();
        const email = String(item.email || '').toLowerCase();
        const crmOwnerId = String(item.crmOwnerId || '').toLowerCase();
        const assignedCollectorId = String(item.assignedCollectorId || '').toLowerCase();
        const id = String(item.id || '').toLowerCase();
        const total = String(item.total || '');
        const notes = (item.notes || []).join(' ').toLowerCase();

        return matchesSearch(
            [company, contactPerson, contactPhone, email, crmOwnerId, crmDisplayName,
             assignedCollectorId, collectorDisplayName, id, total, notes],
            searchTerm,
        );
    });
}

/* ------------------------------- commitments ------------------------------ */

export interface CashFlowForecast {
    todayForecast: number; todayCount: number;
    weekForecast: number; weekCount: number;
    totalForecast: number; totalCount: number;
    committedCustomers: { customer: Outstanding; amount: number; dateText: string }[];
}

/** What customers have promised, and by when: today, the next seven days, and everything open. */
export function cashFlowForecast(rows: Outstanding[], today: Date): CashFlowForecast {
    const next7Days = new Date(today);
    next7Days.setDate(next7Days.getDate() + 7);

    let todayForecast = 0, todayCount = 0;
    let weekForecast = 0, weekCount = 0;
    let totalForecast = 0, totalCount = 0;

    const committedCustomers: CashFlowForecast['committedCustomers'] = [];

    rows.forEach(item => {
        if (item.status === FollowUpStatus.Completed) return;
        if (item.forecastAmount && item.forecastAmount > 0) {
            const fDate = item.forecastDate ? new Date(item.forecastDate) : (item.followUpDate ? new Date(item.followUpDate) : new Date());
            fDate.setHours(0, 0, 0, 0);
            totalForecast += item.forecastAmount;
            totalCount++;

            committedCustomers.push({
                customer: item,
                amount: item.forecastAmount,
                dateText: fDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            });

            if (fDate.getTime() === today.getTime()) {
                todayForecast += item.forecastAmount;
                todayCount++;
            } else if (fDate.getTime() > today.getTime() && fDate.getTime() <= next7Days.getTime()) {
                weekForecast += item.forecastAmount;
                weekCount++;
            }
        }
    });

    return {
        todayForecast, todayCount,
        weekForecast, weekCount,
        totalForecast, totalCount,
        committedCustomers: committedCustomers.sort((a, b) => b.amount - a.amount),
    };
}

/* --------------------------- the attention banner -------------------------- */

/**
 * The banner announces the worklist, so it counts the way the cards do:
 * accounts that owe something, by the date rather than the stored status,
 * and never a defaulter.
 */
export function attentionCounts(rows: Outstanding[], today: Date): { urgentCount: number; overdueCount: number } {
    const work = rows.filter(item => hasOutstanding(item) && !isBadDebt(item));
    const urgentCount = work.filter(item => item.isUrgent && item.status !== FollowUpStatus.Completed).length;
    const overdueCount = work.filter(item => getFollowUpCategory(item, today) === 'overdue').length;
    return { urgentCount, overdueCount };
}

/* ------------------------------ the team table ---------------------------- */

/** One row of the team table. */
export interface CrmStat {
    crmId: string;
    crmName: string;
    totalAssigned: number;
    followUpDone: number;
    todayFollowUp: number;
    overdue: number;
    /** Overdue, or nothing planned. */
    unattended: number;
    /** Completed, due today or upcoming: what the score is made of. */
    timelyCount?: number;
    /** Percentage of timely follow-ups. */
    score: number;
    /** On this CRM's books but owing nothing — counted separately, never chased. */
    noDues?: number;
    /** Declared defaulters on this CRM's books — on the recovery list, outside the score. */
    badDebt?: number;
    /**
     * Whether Reports can show this person's accounts. A CRM owns accounts, so
     * Reports can filter to them; a collector's row counts accounts handed to
     * them, which Reports has no filter for — that row stays a number.
     */
    drillable?: boolean;
}

/**
 * Per-CRM collection workload.
 *
 * The bucket key is normalised: the sheet writes a CRM code however the
 * person typing it felt that day, and the user list has its own spelling;
 * keying on the raw string split one person across "ANKUR", "Ankur " and
 * "ankur". Only accounts that actually owe money are counted. An account
 * with a collector on it is work for two people: the CRM who owns it and
 * the collector chasing it.
 */
export function crmPerformance(rows: Outstanding[], users: User[], today: Date): CrmStat[] {
    type Stat = Omit<CrmStat, 'score'> & { timelyCount: number; noDues: number; badDebt: number };
    const statsMap = new Map<string, Stat>();

    const blank = (crmId: string, crmName: string): Stat => ({
        crmId, crmName,
        totalAssigned: 0, followUpDone: 0, todayFollowUp: 0,
        overdue: 0, unattended: 0, timelyCount: 0, noDues: 0, badDebt: 0,
    });

    // Seed the people we know about, so a CRM with an empty book still
    // appears rather than silently dropping off the table.
    users.filter(u => u.role === UserRole.CRM || u.role === UserRole.Collector).forEach(u => {
        const k = ownerKey(u.id);
        if (k) statsMap.set(k, { ...blank(u.id, u.name), drillable: u.role === UserRole.CRM });
    });

    statsMap.set('UNASSIGNED', { ...blank('UNASSIGNED', 'No CRM Assigned'), drillable: true });

    // The one bucket this owner belongs in: keyed by the person's CRM code
    // whenever the value names somebody on the roster.
    const bucketFor = (raw: string | undefined, key: string) => {
        const known = users.find(u => ownerKey(u.id) === key || ownerKey(u.name) === key);
        const bucketKey = known ? ownerKey(known.id) : key;
        if (!statsMap.has(bucketKey)) {
            const label = (raw || '').trim();
            statsMap.set(bucketKey, { ...blank(known?.id || label, known?.name || label), drillable: !known || known.role === UserRole.CRM });
        }
        return statsMap.get(bucketKey)!;
    };

    rows.forEach(item => {
        const ownerK = ownerKey(item.crmOwnerId) || 'UNASSIGNED';
        const collectorK = ownerKey(item.assignedCollectorId);

        const buckets = [bucketFor(item.crmOwnerId, ownerK)];
        if (collectorK && collectorK !== ownerK) {
            // Two spellings of one person resolve to one bucket, so compare
            // the buckets rather than the raw keys.
            const collectorBucket = bucketFor(item.assignedCollectorId, collectorK);
            if (collectorBucket !== buckets[0]) buckets.push(collectorBucket);
        }

        const cat = getFollowUpCategory(item, today);

        for (const stat of buckets) {
            // On the books but owing nothing — real customers, nothing to chase.
            if (!hasOutstanding(item)) {
                stat.noDues++;
                continue;
            }

            // A defaulter on somebody's book is not a follow-up they missed.
            if (isBadDebt(item)) {
                stat.badDebt++;
                continue;
            }

            stat.totalAssigned++;

            if (cat === 'completed') {
                stat.followUpDone++;
                stat.timelyCount++;
            } else if (cat === 'today') {
                stat.todayFollowUp++;
                stat.timelyCount++;
            } else if (cat === 'future') {
                stat.timelyCount++;
            } else if (cat === 'overdue') {
                stat.overdue++;
                stat.unattended++;
            } else if (cat === 'no_follow_up') {
                stat.unattended++;
            }
        }
    });

    return Array.from(statsMap.values()).map(stat => ({
        ...stat,
        score: stat.totalAssigned > 0 ? Math.round((stat.timelyCount / stat.totalAssigned) * 100) : 0,
    }));
}

/* --------------------------------- cheques -------------------------------- */

export interface ChequeSummary {
    todayCount: number; todayAmount: number;
    overdueCount: number; overdueAmount: number;
    activeCount: number; activeAmount: number;
}

/**
 * Cheques this person is responsible for, and where they stand today —
 * the same scoping rule as everything else, and the same date-derived
 * state as the register.
 */
export function chequeSummary(cheques: PdcCheque[], currentUser: User | null, book: Outstanding[], now: Date): ChequeSummary {
    const mine = new Set(scopeTo(currentUser, book).map(a => a.id));
    // Nobody signed in sees no cheques — the rule scopeTo() applies to the
    // book. The render right after sign-out still holds the cheques, and
    // asserting a user here read `.id` off null and blanked the page (T65).
    const visible = !currentUser
        ? []
        : seesWholeBook(currentUser)
            ? cheques
            : cheques.filter(p => mine.has(p.customerId) || isResponsibleFor(currentUser, { crmOwnerId: p.crmOwnerId || '' }));

    let todayCount = 0, todayAmount = 0, overdueCount = 0, overdueAmount = 0;
    let activeCount = 0, activeAmount = 0;

    for (const cheque of visible) {
        const state = chequeState(cheque, now);
        if (!CHEQUE_ACTIVE.includes(state)) continue;
        activeCount++;
        activeAmount += cheque.amount;
        if (state === 'due') { todayCount++; todayAmount += cheque.amount; }
        if (state === 'overdue') { overdueCount++; overdueAmount += cheque.amount; }
    }

    return { todayCount, todayAmount, overdueCount, overdueAmount, activeCount, activeAmount };
}
