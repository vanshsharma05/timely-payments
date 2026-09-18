import { useState, useEffect } from 'react';
import { FollowUpStatus, User, seesWholeBook } from '../types';
import type { FollowUpCategoryFilter, AgeingReportFilter } from '../components/ReportsView';

interface FilterInputs {
    currentUser: User | null;
    isAuthenticated: boolean;
    setTab: (key: string) => void;
}

/**
 * What the Today list and Reports are narrowed to: the search term the app
 * bar, the book and Reports share; the card pressed on Today; the
 * attention banner's and the unattended shortcut's filters; and the person
 * and ageing band a manager arrives in Reports with. One place, because
 * each of the four actions below sets several of them at once.
 */
export function useWorklistFilters({ currentUser, isAuthenticated, setTab }: FilterInputs) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<FollowUpStatus | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<FollowUpCategoryFilter>('all');
    // What Reports opens on when a manager arrives from Today: a person (the
    // team table) and an ageing band (the portfolio card). 'ALL' / 'all' = no filter.
    const [reportCrm, setReportCrm] = useState<string>('ALL');
    const [reportAgeing, setReportAgeing] = useState<AgeingReportFilter>('all');
    /** The attention banner's filter, the unattended shortcut's, and whether the banner shows. */
    const [priorityFilter, setPriorityFilter] = useState(false);
    const [unattendedFilter, setUnattendedFilter] = useState(false);
    const [showNotificationBanner, setShowNotificationBanner] = useState(true);

    /**
     * Filters belong to the person looking, not to the data.
     *
     * These used to be cleared in the same effect that recomputes the view —
     * and that effect depends on `appData`, so *every save* reset them. Log a
     * follow-up from "Due today" and the filter silently fell back to "My
     * accounts": the list you were working stopped showing today's follow-ups
     * and showed all 87 instead, which reads as the follow-ups disappearing.
     * The same happened after grading an account, reassigning one, or a sync
     * landing while you worked.
     *
     * Keyed on who is signed in, so it still clears on sign-in and on a switch
     * of account, and never because a row was written.
     */
    useEffect(() => {
        if (!isAuthenticated || !currentUser) return;
        setShowNotificationBanner(true);
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setCategoryFilter('all');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id, isAuthenticated]);

    const handleCategoryBoxClick = (category: FollowUpCategoryFilter) => {
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setCategoryFilter(current => current === category ? 'all' : category);
    };

    const handleClearFilters = () => {
        setStatusFilter(null);
        setCategoryFilter('all');
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setReportCrm('ALL');
        setReportAgeing('all');
        setSearchTerm('');
    };

    /**
     * From a number on Today to the accounts behind it. Reports opens on the
     * same person, the same follow-up state and the same ageing band the number
     * was counting — nothing else carried over, so a stale filter from an
     * earlier visit cannot hide part of the list.
     */
    const openReport = (opts: { crm?: string; category?: FollowUpCategoryFilter; ageing?: AgeingReportFilter }) => {
        setPriorityFilter(false);
        setUnattendedFilter(false);
        setStatusFilter(null);
        setReportCrm(opts.crm ?? 'ALL');
        setCategoryFilter(opts.category ?? 'all');
        setReportAgeing(opts.ageing ?? 'all');
        setTab('reports');
    };

    /**
     * "Show them" on the attention banner.
     *
     * It used to set priorityFilter, which only the personal dashboard's list
     * reads. On the company dashboard nothing rendered that list, so the banner
     * vanished and nothing else happened. Whoever sees the whole book is taken
     * to the report, filtered to the same accounts the banner counted.
     */
    const handleViewPriorityItems = () => {
        setStatusFilter(null);
        setUnattendedFilter(false);
        setShowNotificationBanner(false);

        if (seesWholeBook(currentUser)) {
            openReport({ category: 'urgent' });
        } else {
            setCategoryFilter('all');
            setPriorityFilter(true);
        }
    };

    /** Whether any Today filter is on (so Clear filters shows); Reports' own two are counted by the caller. */
    const filtersActive = categoryFilter !== 'all' || !!statusFilter || priorityFilter || unattendedFilter;

    return {
        searchTerm, setSearchTerm, statusFilter, categoryFilter, priorityFilter, unattendedFilter,
        reportCrm, reportAgeing, showNotificationBanner, setShowNotificationBanner, filtersActive,
        handleCategoryBoxClick, handleClearFilters, openReport, handleViewPriorityItems,
    };
}
