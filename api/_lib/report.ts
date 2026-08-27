import { GoogleGenAI } from '@google/genai';

/**
 * AI collection report, shared by the local Express dev server (server.ts) and
 * the Vercel serverless function (api/gemini-report.ts).
 *
 * The Gemini key never leaves the server. With no key configured this still
 * returns a useful rule-based report rather than an error, so the feature works
 * on a deployment that has not bought AI credits.
 */

export interface ReportRequest {
    mode?: string;
    customPrompt?: string;
    companyProfile?: { name?: string };
    targetCrm?: string;
    metricsSummary?: {
        totalOutstanding?: number;
        dueOver45?: number;
        over90?: number;
        over135?: number;
        totalPdcInHand?: number;
        averageCollectionDays?: number;
        totalAccounts?: number;
    };
    criticalAccounts?: any[];
}

export interface ReportResponse {
    status: number;
    body: Record<string, unknown>;
}

const MODEL = 'gemini-3.7-flash';

const formatInr = (n: number = 0) => '₹' + Math.round(n).toLocaleString('en-IN');

function modeCopy(mode: string, customPrompt?: string): { title: string; instruction: string } {
    if (mode === 'credit_reduction') {
        return {
            title: 'Credit Days Reduction & Working Capital Optimization Report',
            instruction: `Focus primarily on reducing the number of credit days across customer accounts.
1. Identify high-risk customers with excessive average collection days (>60-90 days).
2. Recommend specific, tighter credit terms (e.g. reduce from 60 to 30 days, or mandate 50% advance / PDC before next dispatch).
3. Provide tactical talking points and scripts for CRMs to negotiate reduced credit periods without losing business.
4. Establish concrete milestones to bring overall company average collection days down to <45 days.`,
        };
    }
    if (mode === 'overdue_recovery') {
        return {
            title: 'High-Risk Overdue (>90d & >135d) Bad Debt Recovery Action Plan',
            instruction: `Focus on aggressive recovery of stuck and delayed payments.
1. Segment accounts into >135 days (Critical / Legal Alert) and 91-135 days (High Risk).
2. Detail an escalation matrix (formal notice, senior management intervention, halting order dispatch, requiring upfront clearance).
3. Propose realistic payment installment schedules and security PDC acquisition targets.`,
        };
    }
    if (mode === 'crm_performance') {
        return {
            title: 'CRM Follow-up Velocity & Accountability Audit',
            instruction: `Evaluate collection performance and follow-up discipline.
1. Highlight accounts with 'No Follow-up Scheduled' or 'Overdue Follow-up'.
2. Provide a daily call cadence roster for CRMs with measurable targets.
3. Recommend incentive/discipline benchmarks to ensure 100% follow-up coverage.`,
        };
    }
    if (mode === 'cash_forecast') {
        return {
            title: '15-Day Cash Inflow & Liquidity Forecast',
            instruction: `Project expected cash inflows and PDC realizations over the next 15 to 30 days.
1. Calculate expected realization from active PDCs in hand.
2. Forecast collectible amounts from Today and Upcoming follow-up commitments.
3. Highlight liquidity bottlenecks and high-impact accounts that move the needle.`,
        };
    }
    return {
        title: 'Custom Strategic Executive Briefing',
        instruction: `Address the user's specific request: "${customPrompt || 'Comprehensive financial collection analysis'}". Provide deep actionable insights based on the provided portfolio metrics.`,
    };
}

export async function buildReport(req: ReportRequest): Promise<ReportResponse> {
    const {
        mode = 'credit_reduction',
        customPrompt,
        companyProfile,
        targetCrm = 'ALL',
        metricsSummary,
        criticalAccounts = [],
    } = req || {};

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const companyName = companyProfile?.name || 'Shori Chemicals Pvt. Ltd.';

    const totalOutstanding = formatInr(metricsSummary?.totalOutstanding);
    const due45 = formatInr(metricsSummary?.dueOver45);
    const over90 = formatInr(metricsSummary?.over90);
    const over135 = formatInr(metricsSummary?.over135);
    const pdcInHand = formatInr(metricsSummary?.totalPdcInHand);
    const avgDays = metricsSummary?.averageCollectionDays || 0;
    const accountsCount = metricsSummary?.totalAccounts || 0;

    const accountsListText = criticalAccounts
        .slice(0, 15)
        .map((acc: any, idx: number) => {
            return `${idx + 1}. **${acc.company}** (CRM: ${acc.crm || 'Unassigned'})
   - Total Due: ${formatInr(acc.totalDue)} | >45d Due: ${formatInr(acc.dueOver45)} | >90d: ${formatInr(acc.over90)} | >135d: ${formatInr(acc.over135)}
   - Estimated Collection/Ageing Days: ${acc.avgDays || 0} days | Status: ${acc.status || 'Active'}
   - PDC in Hand: ${formatInr(acc.activePdc || 0)}
   - Last Follow-up Note: "${acc.lastNote || 'No recent note'}"`;
        })
        .join('\n\n');

    const { title: modeTitle, instruction: modeInstruction } = modeCopy(mode, customPrompt);

    if (!apiKey) {
        // High-quality algorithmic report for deployments with no Gemini key.
        const generatedReport = `### 📊 ${modeTitle}
**Company:** ${companyName} | **Scope:** ${targetCrm === 'ALL' ? 'Company-Wide Portfolio' : `CRM: ${targetCrm}`}
**Generated On:** ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}

---

#### 1. 🎯 Executive Portfolio & Credit Days Health
- **Total Accounts Analyzed:** ${accountsCount} accounts
- **Total Outstanding Portfolio:** ${totalOutstanding}
- **Overdue > 45 Days (Working Capital Drag):** ${due45} (${metricsSummary?.totalOutstanding ? Math.round(((metricsSummary.dueOver45 || 0) / metricsSummary.totalOutstanding) * 100) : 0}% of portfolio)
- **High-Risk Overdue (>90 Days):** ${over90}
- **Critical Aging (>135 Days):** ${over135}
- **Active PDC Cheques in Hand:** ${pdcInHand} (Security buffer)
- **Company Average Collection Days (DSO Index):** **${avgDays} days** *(Target: ≤ 45 days | Excess: ${Math.max(0, avgDays - 45)} days)*

---

#### 2. ⚡ Key Action Priorities to Reduce Credit Days
1. **Enforce 45-Day Hard Credit Ceiling:**
   - Any customer with average collection days exceeding **75 days** must be placed on temporary order hold until overdue invoices are cleared.
2. **Collect PDC Before Dispatch:**
   - For all accounts in the 46–90 days bracket, mandate securing a stamped Post-Dated Cheque (PDC) before releasing fresh chemical consignments.
3. **Escalate >135 Days Accounts:**
   - Accounts with outstanding older than 135 days totaling ${over135} require immediate registered demand notices and director-level intervention.
4. **CRM Daily Follow-up Coverage:**
   - Ensure 100% of accounts with pending or overdue follow-ups have committed payment dates logged in the system.

---

#### 3. 🚨 Top Priority Customer Accounts for Credit Days Reduction
${accountsListText || '_No specific overdue accounts passed in this filter._'}

---

> 💡 **Pro-Tip for Gemini AI Customization:** Connect your Google Gemini API Key in the environment settings to unlock real-time generative reasoning, customized dispute analysis, and tailored CRM call scripts.`;

        return {
            status: 200,
            body: {
                ok: true,
                reportMarkdown: generatedReport,
                mode,
                modelUsed: 'rule-based-engine (Set GEMINI_API_KEY for Live GenAI)',
                hasApiKey: false,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    const ai = new GoogleGenAI({ apiKey });

    const promptText = `You are the Chief Financial Officer and Senior Credit Risk Advisor for "${companyName}".
Your objective is to help the business decrease customer credit days, accelerate cash flow collections, recover overdue receivables, and minimize bad debts.

METRICS OVERVIEW:
- Company: ${companyName}
- Scope: ${targetCrm === 'ALL' ? 'Company-Wide Portfolio' : `CRM Owner: ${targetCrm}`}
- Total Accounts: ${accountsCount}
- Total Outstanding Balance: ${totalOutstanding}
- Total Overdue > 45 Days: ${due45}
- Total Overdue > 90 Days: ${over90}
- Total Overdue > 135 Days: ${over135}
- Active PDC Cheques in Hand: ${pdcInHand}
- Current Weighted Average Collection Period: ${avgDays} days (Target: ≤ 45 days)

CRITICAL CUSTOMER ACCOUNTS DATA:
${accountsListText || 'No specific account details.'}

REPORT REQUIREMENTS:
Title: ${modeTitle}
${modeInstruction}

Formatting Guidelines:
- Use clean Markdown with clear headings (###, ####), bullet points, bold key figures, and concise actionable tables where helpful.
- Provide concrete numbers, specific customer names from the list, and realistic credit reduction strategies.
- Maintain a professional, assertive, and constructive executive tone.
- Include a specific section titled "🎯 Immediate 7-Day Action Plan for CRMs".`;

    const response = await ai.models.generateContent({
        model: MODEL,
        contents: promptText,
        config: { temperature: 0.3 },
    });

    return {
        status: 200,
        body: {
            ok: true,
            reportMarkdown: response.text || 'Unable to generate report text.',
            mode,
            modelUsed: MODEL,
            hasApiKey: true,
            generatedAt: new Date().toISOString(),
        },
    };
}
