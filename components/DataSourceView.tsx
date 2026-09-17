import React, { useState } from 'react';
import { Button, Card } from './ui/Primitives';
import { Disclosure } from './ui/Disclosure';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DownloadIcon, UploadIcon, SyncIcon, ClipboardListIcon, TrashIcon, CheckCircleIcon, ExclamationTriangleIcon } from './icons/Icons';
import { SyncPreview, describePreview, syncAge } from '../services/syncPreview';

/** What "Check the sheet" found, kept until the next check or sync. */
export interface SheetCheck {
    at: string;
    url: string;
    error?: string;
    rows?: number;
    updatedTillDate?: string;
    preview?: SyncPreview;
}

export interface DataSourceViewProps {
    isAdmin: boolean;
    dataSourceMode: 'excel' | 'google';
    onDataSourceMode: (mode: 'excel' | 'google') => void;
    googleSheetUrl: string;
    onGoogleSheetUrl: (url: string) => void;
    officialSheetUrl: string;
    customerMasterSheetUrl: string;
    onCustomerMasterSheetUrl: (url: string) => void;
    officialMasterUrl: string;
    liveStockSheetUrl: string;
    lastSyncTime: string;
    sheetUpdatedTillDate: string;
    /** Accounts with dues on file, for the status line. */
    accountsWithDues: number;
    isSyncing: boolean;
    sheetCheck: SheetCheck | null;
    /** Reads the sheet and opens the review; nothing is written until the review is confirmed. */
    onSync: () => void;
    /** Reads the sheet and reports what a sync would do, without opening anything. */
    onCheckSheet: () => void;
    /** Opens the review on what the last check read, without reading again. */
    onReviewCheck: () => void;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    expectedHeaders: string[];
    onDownloadTemplate: () => void;
    onCopyHeaders: () => void;
    /** The one-time customer import, already confirmed by the person. */
    onImportCustomers: () => void;
    crmConflicts: { company: string; appCrm: string; sheetCrm: string }[];
    onExportCrmAssignments: () => void;
    /** Reads the sheet and opens the fresh-start dialog (backup + typed phrase). Admin only. */
    onFreshStart: () => void;
}

const FIELD = 'w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[12.5px] font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/40';
const LABEL = 'block text-[11.5px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1';

/**
 * Where the balances come from, whether they are fresh, and what the next
 * sync will do — before the settings, and well away from the reset.
 *
 * The page used to open on a fifteen-column sample table for a spreadsheet
 * format most people never upload, kept "Last Synced" green and pulsing
 * however old it was, put the one everyday button beside a monospace URL in
 * the middle, and ended with a red "Reset All Data" among the other buttons.
 * Now: health and the everyday action first, in plain words; what the sheet
 * controls beside what the app controls; the settings and the one-time
 * import folded; the fresh start in a red-bordered card of its own, Admin
 * only, that says what it clears, what it keeps, and that it asks for a
 * backup and a typed word before anything happens.
 */
export const DataSourceView: React.FC<DataSourceViewProps> = (p) => {
    const [confirmImport, setConfirmImport] = useState(false);
    const age = syncAge(p.lastSyncTime);
    const google = p.dataSourceMode === 'google';
    const usingOfficial = p.googleSheetUrl.trim() === p.officialSheetUrl.trim();
    const TONE: Record<typeof age.tone, { dot: string; text: string }> = {
        fresh: { dot: 'bg-pos', text: 'text-pos' },
        ageing: { dot: 'bg-warn', text: 'text-warn' },
        stale: { dot: 'bg-dang', text: 'text-dang' },
        never: { dot: 'bg-label-4', text: 'text-label-2' },
    };
    const checkedAt = p.sheetCheck ? new Date(p.sheetCheck.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';

    return (
        <div className="space-y-4">
            {/* ---------- health, and the everyday action ---------- */}
            <Card className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-2.5 h-2.5 rounded-full flex-none ${TONE[age.tone].dot}`} aria-hidden="true" />
                            <h2 className="text-[17px] font-extrabold text-label tracking-[-0.02em]">
                                {google ? 'Balances come from the Google Sheet' : 'Balances come from an Excel file you upload'}
                            </h2>
                            <span className={`text-[12.5px] font-bold ${TONE[age.tone].text}`} data-testid="sync-age">{age.label}</span>
                        </div>
                        <p className="text-[13.5px] text-label-2 mt-1.5">
                            {age.detail}
                            {p.sheetUpdatedTillDate ? <> The sheet's figures were updated till <strong className="text-label">{p.sheetUpdatedTillDate}</strong>.</> : null}
                            {' '}{p.accountsWithDues.toLocaleString('en-IN')} accounts with dues on file.
                        </p>
                        <p className="text-[13px] text-label-3 mt-1.5">
                            Syncing reads the sheet and shows you what would change. Nothing is written until you confirm the review.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-none max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                        {google && (
                            <Button size="sm" variant="quiet" onClick={p.onCheckSheet} disabled={p.isSyncing} title="Reads the sheet and says what a sync would do. Writes nothing.">
                                Check the sheet
                            </Button>
                        )}
                        {google && (
                            <Button size="sm" variant="primary" onClick={p.onSync} disabled={p.isSyncing} title="Reads the sheet and opens the review. Nothing is written until you confirm." icon={<SyncIcon />}>
                                {p.isSyncing ? 'Reading the sheet…' : 'Sync balances'}
                            </Button>
                        )}
                    </div>
                </div>

                {/* What the last check found: the next sync, before it happens */}
                {google && p.sheetCheck && (
                    <div
                        role={p.sheetCheck.error ? 'alert' : 'status'}
                        className={`mt-4 rounded-[12px] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${p.sheetCheck.error ? 'bg-dang-bg text-dang' : 'bg-card-2 text-label'}`}
                    >
                        <div className="flex items-start gap-2.5 min-w-0">
                            <span className="mt-0.5 flex-none">{p.sheetCheck.error ? <ExclamationTriangleIcon className="w-[18px] h-[18px]" /> : <CheckCircleIcon className="w-[18px] h-[18px] text-pos" />}</span>
                            <div className="text-[13px] leading-snug">
                                {p.sheetCheck.error ? (
                                    <>
                                        <strong>The sheet could not be read</strong> (checked {checkedAt}): {p.sheetCheck.error}
                                        <span className="block text-[12.5px] mt-1 opacity-90">Nothing was changed. Check the link below, that the sheet is shared as "Anyone with the link can view", and that you are online.</span>
                                    </>
                                ) : (
                                    <>
                                        <strong>Sheet reachable</strong> · {p.sheetCheck.rows?.toLocaleString('en-IN')} rows{p.sheetCheck.updatedTillDate ? ` · updated till ${p.sheetCheck.updatedTillDate}` : ''} · checked {checkedAt}
                                        {p.sheetCheck.preview && (
                                            <span className="block text-[12.5px] text-label-2 mt-0.5">
                                                <strong className="text-label">Next sync:</strong> {describePreview(p.sheetCheck.preview)}.
                                                {p.sheetCheck.preview.added > 0 ? ' New customers arrive with no CRM owner.' : ''}
                                                {p.sheetCheck.preview.settled > 0 ? ' Accounts the sheet no longer lists are settled to zero; their details and history stay.' : ''}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                        {!p.sheetCheck.error && p.sheetCheck.preview && (
                            <Button size="sm" variant="secondary" onClick={p.onReviewCheck} disabled={p.isSyncing} className="flex-none">
                                Review and update
                            </Button>
                        )}
                    </div>
                )}

                {/* Who controls what, said once and plainly */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                    <div className="rounded-[12px] bg-card-2 px-4 py-3">
                        <span className={LABEL}>The sheet controls</span>
                        <ul className="text-[13px] text-label-2 space-y-0.5">
                            <li>· How much each customer owes (the balance)</li>
                            <li>· How old that money is (the ageing buckets and the over-90 figures)</li>
                            <li>· Which accounts are settled — a name that drops off the sheet goes to zero</li>
                        </ul>
                    </div>
                    <div className="rounded-[12px] bg-card-2 px-4 py-3">
                        <span className={LABEL}>The app controls — a sync never touches these</span>
                        <ul className="text-[13px] text-label-2 space-y-0.5">
                            <li>· Customers, contacts, addresses, credit terms and categories</li>
                            <li>· Who owns each account (CRM owners and collectors)</li>
                            <li>· Follow-ups, notes, promises, cheques and the activity history</li>
                        </ul>
                    </div>
                </div>
                <p className="text-[12.5px] text-label-3 mt-3">
                    A name in the sheet that the customer list has never seen is added so its money is counted, with no owner — it shows under <strong className="text-label-2">Unassigned</strong> in the customer book until someone takes it.
                </p>
            </Card>

            {/* ---------- where the balances come from ---------- */}
            <Card className="p-5">
                <h3 className="text-[15px] font-extrabold text-label tracking-[-0.01em]">Where the balances come from</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3" role="radiogroup" aria-label="Where the balances come from">
                    {([
                        ['google', 'Google Sheet', 'Live and shared. Everyone syncs from the same sheet the accounts team keeps.'],
                        ['excel', 'Excel upload', 'By hand, when there is no sheet. Reviewed before anything is saved, like a sync.'],
                    ] as const).map(([mode, title, hint]) => (
                        <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={p.dataSourceMode === mode}
                            onClick={() => p.onDataSourceMode(mode)}
                            className={`text-left rounded-[12px] px-4 py-3 transition-colors ${p.dataSourceMode === mode ? 'bg-accent-tint ring-2 ring-accent' : 'bg-card-2 hover:bg-hover'}`}
                        >
                            <span className="block text-[13.5px] font-bold text-label">{title}</span>
                            <span className="block text-[12.5px] text-label-3 mt-0.5">{hint}</span>
                        </button>
                    ))}
                </div>

                {google ? (
                    <div className="mt-4">
                        <label htmlFor="sheetUrl" className={LABEL}>Outstanding sheet link</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                id="sheetUrl"
                                type="text"
                                value={p.googleSheetUrl}
                                onChange={(e) => p.onGoogleSheetUrl(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/…"
                                className={FIELD}
                            />
                            {!usingOfficial && (
                                <Button size="sm" variant="quiet" onClick={() => p.onGoogleSheetUrl(p.officialSheetUrl)} className="flex-none" title="Put the company's official outstanding sheet back">
                                    Use the official sheet
                                </Button>
                            )}
                        </div>
                        <p className="text-[12.5px] text-label-3 mt-1.5">
                            {usingOfficial ? 'This is the company\'s official outstanding sheet.' : 'Not the official sheet — make sure this is the one the accounts team keeps.'}
                            {' '}The sheet must be shared as "Anyone with the link can view". Only balances and ageing are read from it.
                        </p>
                    </div>
                ) : (
                    <div className="mt-4 space-y-3">
                        <div className="flex flex-col items-center justify-center border-2 border-dashed border-separator-strong rounded-[12px] p-8 text-center">
                            <p className="text-[13px] text-label-2 mb-3">
                                Upload the .xlsx file. It is reviewed before anything is saved — you will see what changes and can cancel.
                            </p>
                            <label htmlFor="file-upload" className="cursor-pointer inline-flex items-center gap-2 h-10 px-5 rounded-full text-[14px] font-semibold bg-accent text-on-accent hover:bg-accent-press shadow-e1">
                                <UploadIcon />
                                <span>{p.isSyncing ? 'Reading the file…' : 'Choose an Excel file'}</span>
                            </label>
                            <input id="file-upload" name="file-upload" type="file" className="sr-only" accept=".xlsx, .xls" onChange={p.onFileChange} disabled={p.isSyncing} />
                        </div>
                        <Disclosure title="Columns the file must have" summary="15 columns, in this order, starting in row 1">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <Button size="sm" variant="quiet" onClick={p.onDownloadTemplate} icon={<DownloadIcon />}>Download a blank template</Button>
                                <Button size="sm" variant="quiet" onClick={p.onCopyHeaders} icon={<ClipboardListIcon className="w-4 h-4" />}>Copy the column headers</Button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-[12px] text-left text-label-3">
                                    <thead className="text-[11px] uppercase tracking-wider text-label-2 bg-card-2">
                                        <tr>{p.expectedHeaders.map((h, i) => <th key={i} className="px-2 py-1 border border-separator whitespace-nowrap">{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        <tr className="bg-card">
                                            {['out_1', 'Acme Corp', 'John Doe', '9876543210', '5000', '5000', '0', '0', '0', 'Priya Singh', 'Amit Kumar', '2023-12-01', 'Follow up', 'FALSE', '2023-01-01'].map((v, i) => (
                                                <td key={i} className={`px-2 py-1 border border-separator ${i === 0 ? 'font-mono' : ''}`}>{v}</td>
                                            ))}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </Disclosure>
                    </div>
                )}
            </Card>

            {/* ---------- the one-time import, folded ---------- */}
            <Disclosure
                title="One-time customer import"
                summary="Loads customers in bulk from the Customer Master sheet. Not a sync — normally you add customers in the book."
                className="shadow-e1 border-0"
            >
                <div className="space-y-4">
                    <p className="text-[13px] text-label-2 leading-relaxed">
                        This reads the Customer Master sheet once and <strong className="text-label">fills in blanks only</strong>: a customer already on file keeps every detail recorded here — name, phones, address, credit terms, category and CRM owner. Names not on file are added. It brings no balances, so the "last synced" time does not change.
                    </p>
                    <div>
                        <label htmlFor="masterUrl" className={LABEL}>Customer Master sheet link</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                id="masterUrl"
                                type="text"
                                value={p.customerMasterSheetUrl}
                                onChange={(e) => p.onCustomerMasterSheetUrl(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/…"
                                className={FIELD}
                            />
                            {p.customerMasterSheetUrl.trim() !== p.officialMasterUrl.trim() && (
                                <Button size="sm" variant="quiet" onClick={() => p.onCustomerMasterSheetUrl(p.officialMasterUrl)} className="flex-none">Use the official master</Button>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => setConfirmImport(true)} disabled={p.isSyncing} className="flex-none" icon={<SyncIcon />}>
                                {p.isSyncing ? 'Importing…' : 'Import customers…'}
                            </Button>
                        </div>
                    </div>
                    <div className="rounded-[12px] bg-card-2 px-4 py-3 space-y-2">
                        <span className={LABEL}>Who owns which account</span>
                        <p className="text-[12.5px] text-label-2 leading-relaxed">
                            Owners are set in the app, in the customer book, and a sync never hands an account back to whoever the sheet has. Nothing can be written to Google Sheets from here, so to bring the sheet in line, download the owner list below and paste its CRM column into the Customer Master sheet.
                        </p>
                        {p.crmConflicts.length > 0 && (
                            <div className="rounded-lg bg-warn-bg px-3 py-2.5">
                                <p className="text-[12.5px] font-bold text-warn">
                                    {p.crmConflicts.length} account{p.crmConflicts.length === 1 ? '' : 's'} where the sheet names a different owner than the app
                                </p>
                                <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                                    {p.crmConflicts.slice(0, 25).map(c => (
                                        <li key={c.company} className="text-[12px] text-label-2">
                                            <span className="font-semibold text-label">{c.company}</span>{' — app: '}<span className="font-mono">{c.appCrm}</span>{', sheet: '}<span className="font-mono">{c.sheetCrm}</span>
                                        </li>
                                    ))}
                                </ul>
                                {p.crmConflicts.length > 25 && <p className="text-[11.5px] text-label-3 mt-1">And {p.crmConflicts.length - 25} more — the download lists every one.</p>}
                            </div>
                        )}
                        <Button size="sm" variant="quiet" onClick={p.onExportCrmAssignments} icon={<DownloadIcon />}>Download the CRM owner list for the sheet</Button>
                    </div>
                </div>
            </Disclosure>

            {/* ---------- the third sheet, read live ---------- */}
            <Card className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-[15px] font-extrabold text-label tracking-[-0.01em]">Live stock sheet</h3>
                    <p className="text-[13px] text-label-2 mt-1">
                        The <strong className="text-label">Live stock</strong> tab reads the stores sheet directly and re-reads it every minute while it is open. Nothing from it is imported or stored here.
                    </p>
                </div>
                <a href={p.liveStockSheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center h-8 px-3.5 rounded-full text-[13px] font-semibold bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label whitespace-nowrap flex-none">
                    Open the stock sheet ↗
                </a>
            </Card>

            {/* ---------- recovery only: Admin, red-bordered, at the end ---------- */}
            {p.isAdmin && (
                <section aria-labelledby="fresh-start-title" className="rounded-[16px] border-2 border-dang/40 bg-card p-5">
                    <div className="flex items-center gap-2">
                        <ExclamationTriangleIcon className="w-5 h-5 text-dang flex-none" />
                        <h3 id="fresh-start-title" className="text-[15px] font-extrabold text-dang tracking-[-0.01em]">Fresh start — recovery only</h3>
                    </div>
                    <p className="text-[13px] text-label-2 mt-2">
                        Not a sync. This wipes the team's working notes and rebuilds the balances from the sheet, for the whole company, in one step. Use it only to recover from a mess — never as a routine refresh.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div className="rounded-[12px] bg-dang-bg px-4 py-3">
                            <span className="block text-[11.5px] font-bold uppercase tracking-wider text-dang mb-1">It clears, for everyone</span>
                            <ul className="text-[13px] text-label-2 space-y-0.5">
                                <li>· Every follow-up date, note and promise</li>
                                <li>· Every post-dated cheque in the register</li>
                                <li>· Message templates, the company profile and these source settings (back to defaults)</li>
                            </ul>
                        </div>
                        <div className="rounded-[12px] bg-card-2 px-4 py-3">
                            <span className="block text-[11.5px] font-bold uppercase tracking-wider text-label-3 mb-1">It keeps</span>
                            <ul className="text-[13px] text-label-2 space-y-0.5">
                                <li>· Customers, their contacts and details, with the same ids</li>
                                <li>· CRM owners, collectors and the activity history</li>
                                <li>· Team logins (managed in Team &amp; access)</li>
                            </ul>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                        <p className="text-[12.5px] text-label-3">
                            Before anything happens it reads the live sheet, shows exact counts, asks you to download a backup, takes its own snapshot in the database, and needs the word <strong className="font-mono text-label-2">RESET</strong> typed.
                        </p>
                        <Button size="sm" variant="danger" onClick={p.onFreshStart} disabled={p.isSyncing} icon={<TrashIcon />} className="flex-none">
                            Start a fresh start…
                        </Button>
                    </div>
                </section>
            )}

            <ConfirmDialog
                open={confirmImport}
                title="Import customers from the master sheet?"
                confirmLabel="Import customers"
                tone="primary"
                onConfirm={() => { setConfirmImport(false); p.onImportCustomers(); }}
                onCancel={() => setConfirmImport(false)}
            >
                <ul className="space-y-1.5">
                    <li>· Customers already on file keep every detail recorded here — nothing is overwritten. Blanks are filled in.</li>
                    <li>· Names not on file are added, with the category and owner the master gives them.</li>
                    <li>· No balances change and the "last synced" time stays as it is.</li>
                </ul>
                <p className="mt-2">Normally you add a customer in the customer book; this is for loading many at once.</p>
            </ConfirmDialog>
        </div>
    );
};

export default DataSourceView;
