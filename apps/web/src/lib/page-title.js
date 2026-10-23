const PAGE_TITLES = {
  '/': 'Control Center',
  '/login': 'Login',
  '/register': 'Register',
  '/link': 'Activation & Nurturing',
  '/recovery': 'Account Recovery',
  '/telegram-otp': 'Telegram OTP',
  '/feedflow': 'FeedFlow',
  '/devices': 'Device Ledger',
  '/ips': 'IP Ledger',
  '/sims': 'SIM Card Ledger',
  '/accounts': 'Resource Ledger',
  '/tickets': 'Business Self-Service Delivery',
  '/governance': 'Dashboard',
  '/audit': 'Audit Log',
  '/offboarding': 'Staff offboarding',
  '/settings': 'RM Supply model',
  '/settings/users': 'User management',
  '/settings/access': 'Network access',
};

export function pageHeadingFor(pathname, role) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/accounts' && role === 'business') return 'Check Account Status';
  return PAGE_TITLES[path] || '';
}

export function pageTitleFor(pathname, role) {
  const heading = pageHeadingFor(pathname, role);
  return heading ? `AMS | ${heading}` : 'AMS';
}
