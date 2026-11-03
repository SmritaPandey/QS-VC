import type { ReactNode } from 'react';

export default function ActionContents({ children }: { children: ReactNode }) {
    return <><span className="qsvc-action__inner">{children}</span><span className="qsvc-action__circle" aria-hidden="true"><span className="mi">north_east</span></span></>;
}
