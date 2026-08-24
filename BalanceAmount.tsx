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
    if (val === undefined || isNaN(val)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Math.abs(val));
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
                    className={`uppercase font-black px-1 py-0.2 rounded tracking-tight bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100 ${
                        size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-xs' : 'text-[10px]'
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
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-tight">
                    Dr
                </span>
            )}
        </span>
    );
};

export default BalanceAmount;
