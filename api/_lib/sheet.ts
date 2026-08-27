/**
 * Google Sheet CSV fetching, shared by the local Express dev server
 * (server.ts) and the Vercel serverless function (api/fetch-sheet.ts) so both
 * environments resolve sheet URLs identically.
 */

const DEFAULT_OFFICIAL_SHEET_ID = '1DoBq1UVK53Z_029eIGUQzZ6g3sN2ytVVFCF0tFoYu_4';

export function getCandidateCsvUrls(inputUrl: string): string[] {
    const urls: string[] = [];
    let trimmed = (inputUrl || '').trim();

    if (!trimmed) {
        trimmed = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pubhtml?gid=895778621&single=true';
    }

    // If input is just the Sheet ID
    if (/^[a-zA-Z0-9-_]{25,}$/.test(trimmed) && !trimmed.startsWith('http')) {
        trimmed = `https://docs.google.com/spreadsheets/d/${trimmed}/edit`;
    }

    // Direct CSV export link
    if (trimmed.includes('output=csv') || trimmed.includes('format=csv')) {
        urls.push(trimmed);
    }

    // Published to Web URLs (e.g. https://docs.google.com/spreadsheets/d/e/2PACX-.../pubhtml?gid=... or /pub)
    if (trimmed.includes('/spreadsheets/d/e/')) {
        const gidMatch = trimmed.match(/gid=([0-9]+)/);
        const gid = gidMatch ? gidMatch[1] : null;

        const baseMatch = trimmed.match(/(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[a-zA-Z0-9-_]+)/);
        const basePath = baseMatch ? baseMatch[1] : trimmed.split('?')[0].replace(/\/pubhtml|\/pub|\/edit.*/, '');

        if (gid) {
            urls.push(`${basePath}/pub?gid=${gid}&single=true&output=csv`);
            urls.push(`${basePath}/pub?output=csv&gid=${gid}`);
        }
        urls.push(`${basePath}/pub?output=csv`);
        urls.push(`${basePath}/pub?gid=0&single=true&output=csv`);
    }

    // Standard Google Sheet URLs (e.g. https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit#gid={GID})
    const sheetIdMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (sheetIdMatch && sheetIdMatch[1] && sheetIdMatch[1] !== 'e') {
        const sheetId = sheetIdMatch[1];
        const gidMatch = trimmed.match(/gid=([0-9]+)/);
        const gid = gidMatch ? gidMatch[1] : '0';

        urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
        urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
        urls.push(`https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv&gid=${gid}`);
    }

    // Fallback: Always try the official published and standard sheets
    urls.push('https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pub?gid=895778621&single=true&output=csv');
    urls.push('https://docs.google.com/spreadsheets/d/e/2PACX-1vRJrKqb_XsMoNYlAzO8NYkhbmZC7Z5RID9W9YFAuh6wzi8gnTIPCXj2LMllgpm78MDmOo7D6zdF0bOc/pub?output=csv');
    urls.push(`https://docs.google.com/spreadsheets/d/${DEFAULT_OFFICIAL_SHEET_ID}/export?format=csv`);
    urls.push(`https://docs.google.com/spreadsheets/d/${DEFAULT_OFFICIAL_SHEET_ID}/gviz/tq?tqx=out:csv`);

    return Array.from(new Set(urls)).filter(isGoogleSheetUrl);
}

/**
 * The browser hands this route a URL and the server fetches it. Without a host
 * check that is an open proxy — anyone could point it at an internal address
 * and read the response. Only Google's spreadsheet hosts are ever needed.
 */
const ALLOWED_HOSTS = ['docs.google.com', 'spreadsheets.google.com'];

export function isGoogleSheetUrl(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        return protocol === 'https:' && ALLOWED_HOSTS.includes(hostname.toLowerCase());
    } catch {
        return false;
    }
}

export async function fetchGoogleSheetCsv(inputUrl: string): Promise<{ csv: string; sourceUrl: string }> {
    const candidateUrls = getCandidateCsvUrls(inputUrl);
    if (!candidateUrls.length) {
        throw new Error('That does not look like a Google Sheet link. Paste the sheet URL from your browser.');
    }
    let lastError: Error | null = null;

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/csv,text/plain,*/*'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                continue;
            }

            const text = await response.text();
            
            // Check if response looks like HTML (login or error page) instead of CSV
            if (text.includes('<!DOCTYPE html>') || text.includes('<html') || text.includes('accounts.google.com')) {
                lastError = new Error('Google returned a login page. Please ensure the Google Sheet sharing setting is "Anyone with the link can view" or File > Share > Publish to web.');
                continue;
            }

            if (text.trim().length > 0) {
                return { csv: text, sourceUrl: url };
            }
        } catch (e: any) {
            lastError = e;
        }
    }

    throw lastError || new Error('Failed to fetch data from the provided Google Sheet URL.');
}
