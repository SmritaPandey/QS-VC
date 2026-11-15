import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';

// Execute the actual effect with controlled hooks; no browser/network setup is needed.
const source = ts.createSourceFile('MeetingToast.tsx', readFileSync(new URL('./MeetingToast.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(ts.isFunctionDeclaration)!;
const js = ts.transpileModule(declaration.getText(source).replace('export default ', '') + '\nreturn MeetingToast;', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
function mountToast(hovered = false, focused = false) {
    const states = [hovered, focused];
    let cleanup: (() => void) | undefined;
    const component = new Function('React', 'useState', 'useEffect', 'window', js)(React,
        () => [states.shift(), vi.fn()], (effect: () => (() => void) | undefined) => { cleanup = effect(); }, globalThis);
    const dismiss = vi.fn();
    component({ children: 'Camera is off', onDismiss: dismiss, duration: 6000 });
    return { dismiss, unmount: () => cleanup?.() };
}
afterEach(() => vi.useRealTimers());
it('dismisses ordinary feedback after six seconds and cancels its timer on unmount', () => {
    vi.useFakeTimers();
    const toast = mountToast();
    vi.advanceTimersByTime(5999); expect(toast.dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(toast.dismiss).toHaveBeenCalledOnce();
    const removed = mountToast(); removed.unmount(); vi.advanceTimersByTime(6000);
    expect(removed.dismiss).not.toHaveBeenCalled();
});
it.each([[true, false], [false, true]])('keeps a notification available while hovered=%s focused=%s', (hovered, focused) => {
    vi.useFakeTimers(); const toast = mountToast(hovered, focused);
    vi.advanceTimersByTime(12000); expect(toast.dismiss).not.toHaveBeenCalled();
});
