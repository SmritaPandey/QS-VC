import { forwardRef, type InputHTMLAttributes } from 'react';
import '../styles/selection-input.css';

// The native input retains labeling, validation, focus, keyboard and form behavior.
const SelectionInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SelectionInput({ type = 'checkbox', ...props }, ref) {
    const isSwitch = type === 'checkbox' && props.role === 'switch';
    return <span className={`qsvc-selection ${isSwitch ? 'is-switch' : type === 'radio' ? 'radio-input' : 'checkbox-wrapper'}`}>
        <input {...props} ref={ref} type={type} />
        <span className={isSwitch ? 'qsvc-switch-indicator' : type === 'radio' ? 'circle' : 'qsvc-checkbox-indicator'} aria-hidden="true" />
    </span>;
});
export default SelectionInput;
