import type { CurrencyRatesState } from '../lib/currency-rates';
import { DISPLAY_CURRENCIES } from '../lib/currency-rates';
import '../styles/currency-selector.css';

type Props = { id: string; value: CurrencyRatesState };

export default function CurrencyRateSelector({ id, value }: Props) {
    const statusMessage = value.status === 'loading' || value.status === 'refreshing'
        ? 'Updating exchange rates.'
        : value.status === 'stale'
            ? 'Exchange rate update failed. Saved rates are being used.'
            : value.status === 'error'
                ? 'Exchange rates are unavailable. Prices remain in INR.'
                : 'Exchange rates are up to date.';

    return <div className="currency-rate-selector" aria-busy={value.status === 'loading' || value.status === 'refreshing'}>
        <label htmlFor={id}>
            <span>Display currency</span>
            <select id={id} value={value.displayCurrency} onChange={event => value.setCurrency(event.target.value as typeof DISPLAY_CURRENCIES[number])}>
                {DISPLAY_CURRENCIES.map(code => <option key={code} value={code} disabled={code !== 'INR' && !value.rates[code]}>{code}</option>)}
            </select>
        </label>
        <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>
        <button type="button" onClick={value.refresh} disabled={value.status === 'loading' || value.status === 'refreshing'}>Refresh rates</button>
    </div>;
}
