import atlas from '../styles/qsvc-participants.webp';

interface Props { person: 0 | 1 | 2 | 3; label: string; className?: string }
export default function Portrait({ person, label, className = '' }: Props) {
    const x = (person % 2) * 768, y = Math.floor(person / 2) * 512;
    return <svg className={`demo-portrait ${className}`} viewBox={`${x} ${y} 768 512`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
        <image href={atlas} width="1536" height="1024" />
    </svg>;
}
