import '../styles/meeting-brand.css';

export default function BrandLogo({ meeting = false, iconOnly = false, name = 'QS-VC' }: { meeting?: boolean; iconOnly?: boolean; name?: string }) {
    return <span className={`qsvc-logo${meeting ? ' qsvc-logo--meeting' : ''}`}>
        <img className="qsvc-logo-symbol" src="/qsvc-brand-mark.svg" alt="" width={42} height={42} />
        <span className={iconOnly ? 'sr-only' : 'qsvc-logo-name'}>{name}</span>
    </span>;
}
