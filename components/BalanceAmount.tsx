import React from 'react';
import { BalanceType } from '../types';

interface BalanceAmountProps {
    amount?: number;
    type?: BalanceType;
    defaultClass?: string;
    showDrLabel?: boolean;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const formatCurrencyValue = (val?: number): string => {
    if (val === undefined || isNaN(val)) return '₹0';
    const abs = Math.abs(val);
    // Receivables here run to lakhs and crores, so paise are pure visual noise.
    // Small balances keep their decimals so a ₹0.45 residue is not shown as ₹0.
    const decimals = abs > 0 && abs < 1000 ? 2 : 0;
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(abs);
};

export const formatBalanceText = (amount?: number, type?: BalanceType): string => {
    const formatted = formatCurrencyValue(amount);
    if (!amount || amount === 0) return formatted;
    return `${formatted} ${type === 'Cr' ? 'Cr (Excess)' : 'Dr'}`;
};

export const BalanceAmount: React.FC<BalanceAmountProps> = ({
    amount = 0,
    type = 'Dr',
    defaultClass = 'text-gray-900 dark:text-gray-100',
    showDrLabel = false,
    className = '',
    size = 'md',
}) => {
    const isCr = type === 'Cr' && amount > 0;
    const formatted = formatCurrencyValue(amount);

    if (isCr) {
        return (
            <span
                className={`inline-flex items-center gap-1 font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800/80 shadow-xs transition-colors ${className}`}
                title={`Excess Payment with us (CR Advance / Credit Balance of ${formatted})`}
            >
                <span>{formatted}</span>
                <span
                    className={`uppercase font-black px-1 py-0.5 rounded tracking-tight bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100 ${
                        size === 'sm' ? 'text-[11px]' : size === 'lg' ? 'text-xs' : 'text-[11.5px]'
                    }`}
                >
                    CR (Excess)
                </span>
            </span>
        );
    }

    return (
        <span className={`inline-flex items-center gap-1 ${defaultClass} ${className}`}>
            <span>{formatted}</span>
            {showDrLabel && amount > 0 && (
                <span className="text-[11.5px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-tight">
                    Dr
                </span>
            )}
        </span>
    );
};

export default BalanceAmount;
