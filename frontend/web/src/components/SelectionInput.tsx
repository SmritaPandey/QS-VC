import { forwardRef, type InputHTMLAttributes } from 'react';
import '../styles/selection-input.css';

// Visual adaptations of Uiverse controls by PriyanshuGupta28 and JaydipPrajapati1910.
// The native input retains labeling, validation, focus, keyboard and form behavior.
const SelectionInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function SelectionInput({ type = 'checkbox', ...props }, ref) {
    const isSwitch = type === 'checkbox' && props.role === 'switch';
    return <span className={`qsvc-selection ${isSwitch ? 'is-switch' : type === 'radio' ? 'radio-input' : 'checkbox-wrapper'}`}>
        <input {...props} ref={ref} type={type} />
        {isSwitch ? <span className="qsvc-switch-indicator" aria-hidden="true" /> : type === 'radio' ? <span className="circle" aria-hidden="true" /> :
            <svg viewBox="0 0 35.6 35.6" aria-hidden="true" focusable="false">
                <circle className="background" cx="17.8" cy="17.8" r="17.8" />
                <circle className="stroke" cx="17.8" cy="17.8" r="14.37" />
                <polyline className="check" points="11.78 18.12 15.55 22.23 25.17 12.87" />
            </svg>}
    </span>;
});
export default SelectionInput;
