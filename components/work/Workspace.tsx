import { useEffect, useMemo, useState } from 'react';
import { Outstanding, PdcCheque, Template, User, seesWholeBook } from '../../types';
import { EmptyState, cx } from '../ui/Primitives';
import Worklist, { QueueKey, buildQueues } from './Worklist';
import AccountPanel from './AccountPanel';

/* ============================================================================
   The workspace: the queue on the left, the account on the right.

   The point of putting them side by side is that working an account never costs
   you your place. There is no dialog to dismiss, so a half-written note cannot
   be lost by clicking the wrong part of the screen, and the next name is always
   in view — which is what makes a call list something you can actually get
   through.

   Below the two-column breakpoint the same two panes become one, and choosing
   an account pushes it over the list. Nothing is hidden on a phone; it is the
   same workspace, one pane at a time.
   ========================================================================== */

interface Props {
    rows: Outstanding[];
    cheques: PdcCheque[];
    currentUser: User;
    users: User[];
    templates: Template[];
    onUpdate: (customer: Outstanding) => void;
    onAddPdc: (customerId: string) => void;
    onUpdatePdcStatus: (chequeId: string, status: any) => void;
    onEditCustomer: (customer: Outstanding) => void;
    onWhatsApp: (customer: Outstanding) => void;
    /** Lets a dashboard card or a link open the workspace on one queue. */
    initialQueue?: QueueKey;
    /** An account to open straight away, arriving from the book or a report. */
    focusId?: string | null;
}

const Workspace = ({
    rows,
    cheques,
    currentUser,
    users,
    templates,
    onUpdate,
    onAddPdc,
    onUpdatePdcStatus,
    onEditCustomer,
    onWhatsApp,
    initialQueue = 'today',
    focusId,
}: Props) => {
    const [queue, setQueue] = useState<QueueKey>(initialQueue);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [showDetailOnPhone, setShowDetailOnPhone] = useState(false);

    const { lists, counts } = useMemo(() => buildQueues(rows, cheques), [rows, cheques]);

    // Arriving from elsewhere with a queue in mind follows the prop, so a second
    // press of the same card re-filters even though this never unmounted.
    useEffect(() => setQueue(initialQueue), [initialQueue]);

    /**
     * Land on the first list that has something in it.
     *
     * "Due today" is the right place to start on a day when something is due,
     * and an empty screen on a day when nothing is — which is most days here,
     * with 607 accounts carrying no follow-up date at all. Opening on the first
     * queue that has work in it means the app always opens on work, and the
     * chips still say plainly what was skipped and why.
     */
    const [landed, setLanded] = useState(false);
    useEffect(() => {
        if (landed || !rows.length) return;
        setLanded(true);
        if (counts[initialQueue] > 0) return;
        const fallback = (['today', 'overdue', 'cheques', 'promised', 'no_plan', 'all'] as QueueKey[])
            .find(k => counts[k] > 0);
        if (fallback) setQueue(fallback);
    }, [landed, rows.length, counts, initialQueue]);

    // Opening one named account — from the customer book, a report or the
    // cheque register — widens the queue to everything, so the account it was
    // asked for is actually in the list beside it rather than filtered out.
    useEffect(() => {
        if (!focusId) return;
        setSelectedId(focusId);
        setShowDetailOnPhone(true);
        setQueue(current => ((lists[current] || []).some(r => r.id === focusId) ? current : 'all'));
    }, [focusId, lists]);


    /**
     * Open the first thing in the queue rather than an empty panel. Somebody
     * who came here to work through a list should not have to choose where to
     * start, and on a wide screen an empty right-hand pane is just a hole.
     */
    useEffect(() => {
        const list = lists[queue] || [];
        if (!list.length) {
            setSelectedId(null);
            return;
        }
        if (!selectedId || !list.some(r => r.id === selectedId)) {
            setSelectedId(list[0].id);
        }
    }, [queue, lists, selectedId]);

    // Always read the account out of the live rows, never a snapshot: the panel
    // stays open while entries are logged against it, and each one writes back.
    const selected = useMemo(
        () => (selectedId ? rows.find(r => r.id === selectedId) || null : null),
        [selectedId, rows],
    );


    return (
        // Two panes only need to be pinned to the viewport where there are two
        // of them. On a phone there is one pane at a time and the page should
        // simply scroll, or the account gets squeezed into whatever height the
        // thread leaves behind.
        <div className="rounded-[16px] overflow-hidden shadow-e1 bg-card grid grid-cols-1 lg:h-[calc(100vh-var(--chrome-h,190px))] lg:min-h-[540px] lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
            <div
                className={cx(
                    'min-h-0 h-[70vh] lg:h-auto lg:border-r border-separator',
                    showDetailOnPhone ? 'hidden lg:block' : 'block',
                )}
            >
                <Worklist
                    rows={rows}
                    cheques={cheques}
                    active={queue}
                    onQueue={key => {
                        setQueue(key);
                        setSelectedId(null);
                    }}
                    selectedId={selected?.id}
                    onSelect={item => {
                        setSelectedId(item.id);
                        setShowDetailOnPhone(true);
                    }}
                    search={search}
                    onSearch={setSearch}
                    showOwner={seesWholeBook(currentUser)}
                />
            </div>

            <div className={cx('min-h-0', showDetailOnPhone ? 'block' : 'hidden lg:block')}>
                {selected ? (
                    <AccountPanel
                        key={selected.id}
                        customer={selected}
                        currentUser={currentUser}
                        users={users}
                        templates={templates}
                        pdcCheques={cheques}
                        onUpdate={onUpdate}
                        onAddPdc={onAddPdc}
                        onUpdatePdcStatus={onUpdatePdcStatus}
                        onEditCustomer={onEditCustomer}
                        onWhatsApp={onWhatsApp}
                        onBack={() => setShowDetailOnPhone(false)}
                    />
                ) : (
                    <EmptyState
                        title="Nothing to chase in this list"
                        hint="Pick another list on the left. Overdue is usually where the money is."
                    />
                )}
            </div>
        </div>
    );
};

export default Workspace;
