import { useCallback, useEffect, useState } from 'react';

export const DISPLAY_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'CAD', 'AUD', 'JPY', 'CHF'] as const;
export type DisplayCurrency = typeof DISPLAY_CURRENCIES[number];
export type CurrencyRates = Partial<Record<DisplayCurrency, number>> & { INR: 1 };
export type CurrencyRatesState = {
    currency: DisplayCurrency;
    displayCurrency: DisplayCurrency;
    rates: CurrencyRates;
    rateDate: string | null;
    status: 'loading' | 'refreshing' | 'ready' | 'stale' | 'error';
    setCurrency: (currency: DisplayCurrency) => void;
};

type CachedRates = { rates: CurrencyRates; dates: Partial<Record<DisplayCurrency, string>>; date: string; fetchedAt: number };
const CURRENCY_KEY = 'qsvc:display-currency';
const RATES_KEY = 'qsvc:currency-rates:inr:v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 15 * 60 * 1000;
let memoryCache: CachedRates | null = null;
let pendingRates: Promise<CachedRates> | null = null;
let retryAfter = 0;
const currencySet = new Set<string>(DISPLAY_CURRENCIES);

function readStorage(key: string) {
    try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
    catch { return null; }
}

function saveStorage(key: string, value: string) {
    try { window.localStorage.setItem(key, value); }
    catch { /* Currency selection and rates still work for this visit. */ }
}

function readCachedRates(): CachedRates | null {
    const raw = readStorage(RATES_KEY);
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<CachedRates>;
        if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
            || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || value.fetchedAt < 0 || value.fetchedAt > Date.now() + 60_000
            || !value.rates || typeof value.rates !== 'object' || !value.dates || typeof value.dates !== 'object') return null;
        const rates: CurrencyRates = { INR: 1 };
        const dates: Partial<Record<DisplayCurrency, string>> = {};
        for (const code of DISPLAY_CURRENCIES) {
            if (code === 'INR') continue;
            const rate = value.rates[code];
            const date = value.dates[code];
            if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0
                && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                rates[code] = rate;
                dates[code] = date;
            }
        }
        return Object.keys(rates).length > 1 ? { date: value.date, fetchedAt: value.fetchedAt, rates, dates } : null;
    } catch { return null; }
}

function savedCurrency(): DisplayCurrency {
    const value = readStorage(CURRENCY_KEY);
    return value && currencySet.has(value) ? value as DisplayCurrency : 'INR';
}

function currentRates() {
    const stored = readCachedRates();
    if (stored && (!memoryCache || stored.fetchedAt > memoryCache.fetchedAt)) memoryCache = stored;
    return memoryCache;
}

function loadRates(): Promise<CachedRates> {
    if (pendingRates) return pendingRates;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    const quotes = DISPLAY_CURRENCIES.filter(code => code !== 'INR').join(',');
    pendingRates = fetch(`https://api.frankfurter.dev/v2/rates?base=INR&quotes=${encodeURIComponent(quotes)}`, {
        cache: 'no-store', signal: controller.signal,
    }).then(async response => {
        if (!response.ok) throw new Error('Reference rates are unavailable.');
        const rows: unknown = await response.json();
        if (controller.signal.aborted || !Array.isArray(rows) || rows.length === 0) throw new Error('Reference rates are unavailable.');
        const rates: CurrencyRates = { INR: 1 };
        const dates: Partial<Record<DisplayCurrency, string>> = {};
        let latestDate = '';
        for (const row of rows) {
            if (row?.base !== 'INR' || typeof row?.quote !== 'string'
                || row.quote === 'INR' || !currencySet.has(row.quote) || typeof row?.rate !== 'number'
                || !Number.isFinite(row.rate) || row.rate <= 0
                || typeof row?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
            if (row.date > latestDate) latestDate = row.date;
            rates[row.quote as DisplayCurrency] = row.rate;
            dates[row.quote as DisplayCurrency] = row.date;
        }
        if (!latestDate || Object.keys(rates).length < 3 || controller.signal.aborted) throw new Error('Reference rates are incomplete.');
        const next: CachedRates = { date: latestDate, fetchedAt: Date.now(), rates, dates };
        memoryCache = next;
        retryAfter = 0;
        saveStorage(RATES_KEY, JSON.stringify(next));
        return next;
    }).catch(error => {
        retryAfter = Date.now() + RETRY_DELAY_MS;
        throw error;
    }).finally(() => {
        window.clearTimeout(timeout);
        pendingRates = null;
    });
    return pendingRates;
}

export function useCurrencyRates(): CurrencyRatesState {
    const [currency, setCurrencyValue] = useState<DisplayCurrency>(savedCurrency);
    const [cached, setCached] = useState<CachedRates | null>(currentRates);
    const [status, setStatus] = useState<CurrencyRatesState['status']>(() => currentRates() ? 'ready' : 'loading');

    useEffect(() => {
        let active = true;
        let running = false;
        let timer = 0;
        const update = async () => {
            if (!active || running) return;
            running = true;
            window.clearTimeout(timer);
            const existing = currentRates();
            setCached(existing);
            try {
                if (existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) setStatus('ready');
                else if (Date.now() < retryAfter) setStatus(existing ? 'stale' : 'error');
                else {
                    setStatus(existing ? 'refreshing' : 'loading');
                    const next = await loadRates();
                    if (active) { setCached(next); setStatus('ready'); }
                }
            } catch {
                if (active) setStatus(currentRates() ? 'stale' : 'error');
            } finally {
                running = false;
                if (active) {
                    const refreshAt = Math.max((currentRates()?.fetchedAt || 0) + CACHE_TTL_MS, retryAfter);
                    timer = window.setTimeout(() => void update(), Math.max(1000, refreshAt - Date.now()));
                }
            }
        };
        const refreshIfStale = () => { void update(); };
        void update();
        window.addEventListener('focus', refreshIfStale);
        window.addEventListener('online', refreshIfStale);
        return () => {
            active = false;
            window.clearTimeout(timer);
            window.removeEventListener('focus', refreshIfStale);
            window.removeEventListener('online', refreshIfStale);
        };
    }, []);

    const setCurrency = useCallback((next: DisplayCurrency) => {
        if (!currencySet.has(next) || (next !== 'INR' && !cached?.rates[next])) return;
        setCurrencyValue(next);
        saveStorage(CURRENCY_KEY, next);
    }, [cached]);
    const rates = cached?.rates || { INR: 1 as const };
    const displayCurrency = rates[currency] ? currency : 'INR';

    return { currency, displayCurrency, rates, rateDate: (displayCurrency !== 'INR' ? cached?.dates[displayCurrency] : null) || cached?.date || null, status, setCurrency };
}

export function formatConvertedAmount(amountInInr: number, currency: DisplayCurrency, rates: CurrencyRates) {
    const conversionRate = rates[currency] || 1;
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
        style: 'currency', currency,
    }).format(amountInInr * conversionRate);
}

export function formatRateDate(date: string | null) {
    if (!date) return '';
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
