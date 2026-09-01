import React from 'react';

const paths = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M9.5 20v-5h5v5" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="4" rx="2" /><rect x="14" y="11" width="7" height="10" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /></>,
  cargo: <><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /><path d="M12 12v8" /></>,
  addCargo: <><path d="m3 9 7-3.5L17 9l-7 3.5L3 9Z" /><path d="M3 9v7l7 3.5 7-3.5V9" /><path d="M10 12.5v7" /><path d="M20 4v6M17 7h6" /></>,
  rfq: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h5M8 16h3" /><path d="m15 15 1.5 1.5L20 13" /></>,
  quote: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v5h5M9 12h7M9 16h5" /><path d="M4 7v13" /></>,
  contract: <><path d="M5 3h11l3 3v15H5z" /><path d="M9 9h6M9 13h6" /><path d="m9 17 2 2 4-4" /></>,
  document: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v5h5M9 12h6M9 16h6" /></>,
  cmr: <><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 9v10" /><path d="M12 13h5M12 16h3" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18h2.2c5 0 1.5-7 6-9.5" /></>,
  tracking: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  truck: <><path d="M3 6h11v11H3z" /><path d="M14 10h4l3 3v4h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></>,
  fleet: <><path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z" /><circle cx="6.5" cy="18" r="2" /><circle cx="16.5" cy="18" r="2" /><path d="M6 4h12" /></>,
  driver: <><circle cx="12" cy="8" r="4" /><path d="M5 21c.7-5 3-7 7-7s6.3 2 7 7" /><path d="M8 8h8M12 4v4" /></>,
  agent: <><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /><path d="m9 15 3 2 3-2" /></>,
  building: <><path d="M4 21V8l8-4 8 4v13" /><path d="M2 21h20M8 10h2M14 10h2M8 14h2M14 14h2M10 21v-4h4v4" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-4 2.2-6 5.5-6s5 2 5.5 6" /><circle cx="17" cy="9" r="2.5" /><path d="M15 15c3.2-.6 5.2 1.2 5.5 5" /></>,
  organization: <><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M8 12h3v3H8zM14 12h3v3h-3zM10 21v-4h4v4" /></>,
  finance: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.9-.7-2-1-3.3-1-1.8 0-3.2.8-3.2 2s1.1 1.8 3.4 2.3c2.2.5 3.3 1.1 3.3 2.4s-1.4 2.2-3.4 2.2c-1.4 0-2.7-.4-3.8-1.2M12 5v14" /></>,
  claim: <><path d="M12 3 3.5 7v5c0 5.1 3.5 8 8.5 9 5-1 8.5-3.9 8.5-9V7L12 3Z" /><path d="M12 8v5M12 17h.01" /></>,
  alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17.5h.01" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 20h4" /></>,
  report: <><path d="M5 3h14v18H5z" /><path d="M8 16v-3M12 16V8M16 16v-6" /></>,
  support: <><circle cx="12" cy="12" r="9" /><path d="M7 13v-2a5 5 0 0 1 10 0v2M7 13H5v4h3v-4Zm10 0h2v4h-3v-4ZM16 18c-.8 1-2 1.5-4 1.5" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.8 3.1 7.8 7.5 9.5 4.4-1.7 7.5-4.7 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>,
  audit: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h4M9 16h3" /><circle cx="17" cy="16" r="3" /><path d="m19.2 18.2 2 2" /></>,
  market: <><path d="M3 9h18l-2-5H5L3 9Z" /><path d="M5 9v11h14V9M9 20v-6h6v6" /><path d="M3 9c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0" /></>,
  rules: <><path d="M5 4h14v16H5z" /><path d="m8 9 1.5 1.5L12 8M14 9h2M8 15l1.5 1.5L12 14M14 15h2" /></>,
  health: <><path d="M3 13h4l2-5 4 10 2-5h6" /><path d="M20 8a8 8 0 1 0 0 8" /></>,
  ai: <><rect x="5" y="5" width="14" height="14" rx="4" /><path d="M9 10h.01M15 10h.01M9 15c2 1.3 4 1.3 6 0M12 2v3M2 12h3M19 12h3" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v5h16v-5" /></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  evidence: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="11" r="2" /><path d="m5 17 4-4 3 3 3-3 4 4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  refresh: <><path d="M20 7v5h-5" /><path d="M18.5 16A8 8 0 1 1 19 8l1 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  location: <><path d="M12 21s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>,
  phone: <path d="M7.5 3.5 5.3 5.7c-1.1 1.1.2 4.6 3.2 7.6 3 3 6.5 4.3 7.6 3.2l2.2-2.2-3.4-3.4-1.5 1.5c-1.4-.7-2.9-2.2-3.6-3.6l1.5-1.5-3.8-3.8Z" />,
  identity: <><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="8.5" cy="11" r="2" /><path d="M6 16c.6-1.8 1.4-2.6 2.5-2.6S10.4 14.2 11 16M14 10h4M14 14h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M5 21c.7-5 3-7 7-7s6.3 2 7 7" /></>
};

export function Icon({ name, size = 22, className = '', title }) {
  const content = paths[name] || paths.dashboard;
  return (
    <svg
      className={`product-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {content}
    </svg>
  );
}

export function GomrokMark({ size = 42, className = '' }) {
  return (
    <svg className={`gomrok-mark${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="15" fill="currentColor" />
      <path d="M13 28.5c0-7.7 4.8-13 12-13 4.7 0 8.1 1.8 10.2 4.9" stroke="#140e04" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M35 19.5v8h-8" stroke="#140e04" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="29" r="4" fill="#4363ea" stroke="#140e04" strokeWidth="2.2" />
      <path d="M16.5 31.5 23 38l9-9" stroke="#140e04" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProductLogo({ compact = false, inverse = false, subtitle = 'کنترل‌تاور حمل و گمرک' }) {
  return (
    <span className={`product-logo${compact ? ' product-logo--compact' : ''}${inverse ? ' product-logo--inverse' : ''}`}>
      <GomrokMark />
      <span className="product-logo__copy">
        <strong>GOMROK</strong>
        {!compact && <small>{subtitle}</small>}
      </span>
    </span>
  );
}

export function LogisticsNetworkIllustration({ className = '' }) {
  return (
    <svg className={`logistics-network${className ? ` ${className}` : ''}`} viewBox="0 0 760 620" fill="none" role="img" aria-label="شبکه حمل‌ونقل، گمرک و ردیابی محموله">
      <defs>
        <linearGradient id="gomrok-ground" x1="88" y1="90" x2="626" y2="548" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe4ff" />
        </linearGradient>
        <linearGradient id="gomrok-blue" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#4c7cff" />
          <stop offset="1" stopColor="#4363ea" />
        </linearGradient>
        <filter id="gomrok-shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="18" stdDeviation="20" floodColor="#283da5" floodOpacity=".18" />
        </filter>
      </defs>
      <path d="M109 438c-62-126 10-295 172-352 147-52 313 7 370 138 59 136-14 273-146 331-148 64-333 12-396-117Z" fill="url(#gomrok-ground)" stroke="#cfd4f5" strokeWidth="2" />
      <path d="M126 392c109-136 210-74 283-174 61-84 123-59 203-21" stroke="#4363ea" strokeWidth="10" strokeLinecap="round" strokeDasharray="2 25" />
      <path d="M141 430c91 43 166 27 233-43 57-59 130-61 227-26" stroke="#0afa82" strokeWidth="5" strokeLinecap="round" strokeDasharray="16 18" opacity=".95" />
      <g filter="url(#gomrok-shadow)">
        <rect x="232" y="166" width="245" height="214" rx="34" fill="#140e04" />
        <rect x="250" y="184" width="209" height="178" rx="24" fill="#232038" />
        <rect x="270" y="207" width="169" height="102" rx="18" fill="#ededff" />
        <path d="M291 276c28-49 61-32 85-62 18-22 33-17 49-7" stroke="url(#gomrok-blue)" strokeWidth="8" strokeLinecap="round" />
        <circle cx="292" cy="276" r="9" fill="#0afa82" stroke="#140e04" strokeWidth="4" />
        <circle cx="376" cy="214" r="9" fill="#4c7cff" stroke="#140e04" strokeWidth="4" />
        <circle cx="425" cy="207" r="9" fill="#0afa82" stroke="#140e04" strokeWidth="4" />
        <rect x="270" y="325" width="72" height="13" rx="6.5" fill="#4c7cff" opacity=".9" />
        <rect x="351" y="325" width="88" height="13" rx="6.5" fill="#0afa82" />
      </g>
      <g transform="translate(73 356)" filter="url(#gomrok-shadow)">
        <rect x="0" y="0" width="185" height="96" rx="22" fill="#4363ea" />
        <rect x="18" y="18" width="105" height="59" rx="12" fill="#4c7cff" />
        <path d="M123 31h32l25 25v21h-57V31Z" fill="#0afa82" />
        <path d="M142 39h11l15 16h-26V39Z" fill="#ededff" />
        <circle cx="45" cy="86" r="17" fill="#140e04" stroke="#ededff" strokeWidth="6" />
        <circle cx="146" cy="86" r="17" fill="#140e04" stroke="#ededff" strokeWidth="6" />
      </g>
      <g transform="translate(494 320)" filter="url(#gomrok-shadow)">
        <path d="M26 33h143l-14 128H40L26 33Z" fill="#fff" stroke="#c7cced" strokeWidth="3" />
        <path d="M42 33 56 7h83l16 26" stroke="#140e04" strokeWidth="10" strokeLinecap="round" />
        <rect x="56" y="62" width="84" height="57" rx="13" fill="#ededff" />
        <path d="m73 90 15 15 34-36" stroke="#079b58" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(535 88)" filter="url(#gomrok-shadow)">
        <path d="M54 0c29 0 52 23 52 52 0 43-52 91-52 91S2 95 2 52C2 23 25 0 54 0Z" fill="#0afa82" stroke="#140e04" strokeWidth="6" />
        <circle cx="54" cy="52" r="19" fill="#140e04" />
        <path d="m45 52 7 7 13-15" stroke="#0afa82" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(97 115)" filter="url(#gomrok-shadow)">
        <rect x="0" y="0" width="129" height="124" rx="27" fill="#fff" stroke="#cbd0ef" strokeWidth="3" />
        <path d="M27 93V42l38-20 38 20v51" stroke="#4363ea" strokeWidth="8" strokeLinejoin="round" />
        <path d="M18 94h94M45 51h13v15H45zM72 51h13v15H72zM53 94V76h24v18" stroke="#140e04" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="647" cy="490" r="20" fill="#4c7cff" stroke="#140e04" strokeWidth="6" />
      <circle cx="116" cy="493" r="15" fill="#0afa82" stroke="#140e04" strokeWidth="5" />
    </svg>
  );
}

export const navigationIconMap = {
  dashboard: 'dashboard',
  'new-request': 'addCargo',
  active: 'cargo',
  rfq: 'rfq',
  rfq1: 'rfq',
  rfq2: 'market',
  pricing: 'quote',
  bids: 'quote',
  contracts: 'contract',
  documents: 'document',
  cmr: 'cmr',
  tracking: 'tracking',
  pod: 'evidence',
  finance: 'finance',
  claims: 'claim',
  notifications: 'bell',
  reports: 'report',
  organization: 'organization',
  security: 'shield',
  support: 'support',
  dispatch: 'route',
  network: 'market',
  nomination: 'driver',
  loading: 'upload',
  exceptions: 'alert',
  trips: 'truck',
  drivers: 'driver',
  vehicles: 'fleet',
  coverage: 'shield',
  opportunities: 'rfq',
  account: 'user',
  delivery: 'agent',
  evidence: 'evidence',
  receipts: 'document',
  discrepancies: 'alert',
  authority: 'key',
  users: 'users',
  organizations: 'building',
  qualification: 'shield',
  marketplace: 'market',
  cases: 'claim',
  audit: 'audit',
  breakglass: 'key',
  rulepacks: 'rules',
  exports: 'download',
  crm: 'organization',
  bi: 'report',
  ai: 'ai',
  health: 'health'
};

export function NavigationIcon({ section, size = 20 }) {
  return <Icon name={navigationIconMap[section] || 'dashboard'} size={size} />;
}

