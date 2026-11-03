interface Props {
    label?: string;
}

/** A status for an operation already pending, never a simulated progress meter. */
export default function LoadingMark({ label = 'Loading…' }: Props) {
    return <span className="loading-status" role="status"><span className="loading-mark" aria-hidden="true"><i /><i /><i /></span><span>{label}</span></span>;
}
