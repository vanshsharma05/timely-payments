import React from 'react';

interface AppLogoProps {
    className?: string;
    size?: number | string;
    variant?: 'full-color' | 'white' | 'dark';
}

export const AppLogo: React.FC<AppLogoProps> = ({ 
    className = "w-8 h-8", 
    size,
    variant = 'full-color' 
}) => {
    // Primary navy color & cyan growth color
    const navyColor = variant === 'white' ? '#FFFFFF' : (variant === 'dark' ? '#0A2540' : '#073B6C');
    const cyanColor = variant === 'white' ? '#E0F7FA' : '#00A8C6';
    const coinBg = variant === 'white' ? '#FFFFFF' : '#00A8C6';
    const coinHighlight = variant === 'white' ? '#B2EBF2' : '#56CFE1';

    return (
        <svg 
            className={className} 
            style={size ? { width: size, height: size } : undefined}
            viewBox="0 0 100 100" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* --- Navy Blue Spreadsheet Grid (Background & Top/Left Frame) --- */}
            <g id="grid-frame">
                {/* Outer Frame Top & Left */}
                <path 
                    d="M18 18H86V36H80V24H24V82H36V88H18V18Z" 
                    fill={navyColor} 
                />
                
                {/* Vertical Grid Columns */}
                {/* Col 1 */}
                <rect x="33" y="24" width="5.5" height="58" fill={navyColor} />
                {/* Col 2 */}
                <rect x="48" y="24" width="5.5" height="38" fill={navyColor} />
                {/* Col 3 */}
                <rect x="63" y="24" width="5.5" height="26" fill={navyColor} />
                {/* Col 4 */}
                <rect x="78" y="24" width="5.5" height="12" fill={navyColor} />

                {/* Horizontal Grid Rows */}
                {/* Row 1 */}
                <rect x="24" y="32" width="56" height="5.5" fill={navyColor} />
                {/* Row 2 */}
                <rect x="24" y="44" width="44" height="5.5" fill={navyColor} />
                {/* Row 3 */}
                <rect x="24" y="56" width="30" height="5.5" fill={navyColor} />
                {/* Row 4 */}
                <rect x="24" y="68" width="16" height="5.5" fill={navyColor} />
            </g>

            {/* --- Vibrant Cyan Growth Curve & Vertical Bars --- */}
            <g id="growth-chart">
                {/* Dynamic upward curve shape from bottom left */}
                <path 
                    d="M34 82C34 82 41 77 46 64L50 64L50 88L34 88V82Z" 
                    fill={cyanColor} 
                />
                <rect x="34" y="74" width="9" height="14" fill={cyanColor} rx="1" />

                {/* Vertical Bar 1 (Left / Shortest) */}
                <rect x="46" y="68" width="10" height="20" fill={cyanColor} rx="1" />

                {/* Vertical Bar 2 (Middle) */}
                <rect x="58" y="60" width="10" height="28" fill={cyanColor} rx="1" />

                {/* Vertical Bar 3 (Right / Tallest) */}
                <rect x="70" y="50" width="10" height="38" fill={cyanColor} rx="1" />
            </g>

            {/* --- Cylindrical Coin Stacks on Top of Bars --- */}
            <g id="coin-stacks">
                {/* Coins on Bar 1 (Center x=51) */}
                {/* Coin 1 Bottom */}
                <ellipse cx="51" cy="57" rx="5" ry="2.2" fill={coinBg} />
                <path d="M46 57V59.5C46 60.7 48.2 61.7 51 61.7C53.8 61.7 56 60.7 56 59.5V57H46Z" fill={coinBg} />
                <ellipse cx="51" cy="57" rx="4.2" ry="1.6" fill={coinHighlight} />

                {/* Coin 1 Top */}
                <ellipse cx="51" cy="52.5" rx="5" ry="2.2" fill={coinBg} />
                <path d="M46 52.5V54.5C46 55.7 48.2 56.7 51 56.7C53.8 56.7 56 55.7 56 54.5V52.5H46Z" fill={coinBg} />
                <ellipse cx="51" cy="52.5" rx="4.2" ry="1.6" fill={coinHighlight} />

                {/* Coins on Bar 2 (Center x=63) */}
                {/* Coin 2 Bottom */}
                <ellipse cx="63" cy="49" rx="5" ry="2.2" fill={coinBg} />
                <path d="M58 49V51.5C58 52.7 60.2 53.7 63 53.7C65.8 53.7 68 52.7 68 51.5V49H58Z" fill={coinBg} />
                <ellipse cx="63" cy="49" rx="4.2" ry="1.6" fill={coinHighlight} />

                {/* Coin 2 Top */}
                <ellipse cx="63" cy="44.5" rx="5" ry="2.2" fill={coinBg} />
                <path d="M58 44.5V46.5C58 47.7 60.2 48.7 63 48.7C65.8 48.7 68 47.7 68 46.5V44.5H58Z" fill={coinBg} />
                <ellipse cx="63" cy="44.5" rx="4.2" ry="1.6" fill={coinHighlight} />

                {/* Coins on Bar 3 (Center x=75) */}
                {/* Coin 3 Bottom */}
                <ellipse cx="75" cy="41" rx="5" ry="2.2" fill={coinBg} />
                <path d="M70 41V43.5C70 44.7 72.2 45.7 75 45.7C77.8 45.7 80 44.7 80 43.5V41H70Z" fill={coinBg} />
                <ellipse cx="75" cy="41" rx="4.2" ry="1.6" fill={coinHighlight} />

                {/* Coin 3 Top */}
                <ellipse cx="75" cy="36.5" rx="5" ry="2.2" fill={coinBg} />
                <path d="M70 36.5V38.5C70 39.7 72.2 40.7 75 40.7C77.8 40.7 80 39.7 80 38.5V36.5H70Z" fill={coinBg} />
                <ellipse cx="75" cy="36.5" rx="4.2" ry="1.6" fill={coinHighlight} />
            </g>
        </svg>
    );
};

export default AppLogo;
