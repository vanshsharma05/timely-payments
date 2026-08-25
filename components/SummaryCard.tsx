import React from 'react';

interface SummaryCardProps {
    title: string;
    value: string;
    icon: React.ReactNode;
    color: string;
    onClick?: () => void;
    isActive?: boolean;
}

const SummaryCard = ({ title, value, icon, color, onClick, isActive }: SummaryCardProps) => {
    
    const baseClasses = "bg-white dark:bg-gray-900 rounded-lg shadow-md p-6 flex items-center space-x-4 transition-all duration-200 ease-in-out";
    const clickableClasses = onClick ?"cursor-pointer hover:shadow-lg hover:scale-[1.03]" :"";
    const activeClasses = isActive ?"ring-2 ring-green-500 shadow-xl scale-[1.03]" :"ring-1 ring-transparent";

    return (
        <div className={`${baseClasses} ${clickableClasses} ${activeClasses}`} onClick={onClick}>
            <div className={`p-3 rounded-full bg-gray-100 dark:bg-gray-800 ${color}`}>
                {icon}
            </div>
            <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{title}</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
            </div>
        </div>
    );
};

export default SummaryCard;