import React from 'react';
import { BRAND, BRAND_LOGOS } from '../config/brand';

const BrandLogo = ({ variant = 'full', className = '', size = 'md' }) => {
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base font-black',
    lg: 'text-lg font-black',
    xl: 'text-xl font-black',
    '2xl': 'text-2xl font-black',
  };

  const logoColor = 'text-polynurse-600 dark:text-polynurse-400';

  if (variant === 'mark') {
    return (
      <span className={`${sizeClasses[size]} ${logoColor} ${className} tracking-wider`}>
        {BRAND_LOGOS.mark}
      </span>
    );
  }

  if (variant === 'short') {
    return (
      <span className={`${sizeClasses[size]} ${logoColor} ${className} tracking-tight`}>
        {BRAND_LOGOS.short}
      </span>
    );
  }

  return (
    <span className={`${sizeClasses[size]} ${logoColor} ${className} tracking-tight`}>
      {BRAND_LOGOS.full}
    </span>
  );
};

export default BrandLogo;