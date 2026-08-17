/**
 * Shared client helpers for all public pages
 */

const API_BASE = '/api';

const state = {
  user: null,
  token: localStorage.getItem('token'),
  currentPage: 1,
  filters: {
    search: '',
    location: '',
    category: '',
    job_type: [],
    posted_after: '',
    salary_min: '',
    salary_max: '',
  },
  sort: 'posted_date',
  order: 'desc',
};

async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token && { Authorization: `Bearer ${state.token}` }),
    ...(options.headers || {}),
  };

  const config = {
    ...options,
    headers,
  };

  const response = await fetch(url, config);
  let data;
  try {
    data = await response.json();
  } catch {
    data = { message: 'Invalid server response' };
  }

  if (!response.ok) {
    const message =
      data.message ||
      (Array.isArray(data.errors) && data.errors[0]?.message) ||
      'Something went wrong';
    const err = new Error(message);
    err.status = response.status;
    err.errors = data.errors;
    throw err;
  }

  return data;
}

function showNotification(message, type = 'info') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }

  const icons = {
    success: 'check-circle',
    error: 'exclamation-circle',
    warning: 'exclamation-triangle',
    info: 'info-circle',
  };

  const notification = document.createElement('div');
  notification.className = `alert alert-${type}`;
  notification.innerHTML = `<i class="fas fa-${icons[type] || icons.info}"></i> <span>${escapeHtml(message)}</span>`;
  host.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(12px)';
    notification.style.transition = 'all 0.25s ease';
    setTimeout(() => notification.remove(), 250);
  }, 3500);
}

async function checkAuth() {
  if (!state.token) {
    updateAuthUI(false);
    return false;
  }

  try {
    const response = await api('/users/profile');
    state.user = response.data;
    updateAuthUI(true);
    return true;
  } catch {
    localStorage.removeItem('token');
    state.token = null;
    state.user = null;
    updateAuthUI(false);
    return false;
  }
}

function updateAuthUI(isLoggedIn) {
  const authButtons = document.getElementById('authButtons');
  const userMenu = document.getElementById('userMenu');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  const mobileAuth = document.getElementById('mobileAuth');

  if (isLoggedIn && state.user) {
    authButtons?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    const display = state.user.name || state.user.email?.split('@')[0] || 'You';
    if (userName) {
      userName.textContent = display;
    }
    if (userAvatar) {
      userAvatar.textContent = display.charAt(0).toUpperCase();
    }
    if (mobileAuth) {
      mobileAuth.innerHTML = `
        <a href="/profile" class="btn btn-ghost btn-block">Profile</a>
        <a href="/alerts" class="btn btn-ghost btn-block">Your alerts</a>
        <a href="/" class="btn btn-ghost btn-block">Browse jobs</a>
        <button type="button" class="btn btn-primary btn-block" id="mobileLogoutBtn">Sign out</button>
      `;
      document.getElementById('mobileLogoutBtn')?.addEventListener('click', () => {
        setMobileMenuOpen(false);
        logout();
      });
    }
  } else {
    authButtons?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    if (mobileAuth) {
      mobileAuth.innerHTML = `
        <a href="/login" class="btn btn-ghost btn-block">Sign in</a>
        <a href="/register" class="btn btn-primary btn-block">Get started</a>
      `;
    }
  }
}

function logout() {
  localStorage.removeItem('token');
  state.token = null;
  state.user = null;
  updateAuthUI(false);
  showNotification('Signed out — see you soon', 'success');
  const protectedPaths = ['/alerts', '/job-alerts', '/saved-jobs', '/profile', '/dashboard'];
  if (protectedPaths.includes(window.location.pathname)) {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
  }
}

function setAuthSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  updateAuthUI(true);
}

let _commonNavReady = false;

function ensureMobileMenuBackdrop() {
  let backdrop = document.getElementById('mobileMenuBackdrop');
  if (backdrop) return backdrop;
  const menu = document.getElementById('mobileMenu');
  if (!menu) return null;
  backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = 'mobileMenuBackdrop';
  backdrop.className = 'mobile-menu-backdrop';
  backdrop.setAttribute('aria-label', 'Close menu');
  menu.insertAdjacentElement('afterend', backdrop);
  backdrop.addEventListener('click', () => setMobileMenuOpen(false));
  return backdrop;
}

function setMobileMenuOpen(open) {
  const menu = document.getElementById('mobileMenu');
  const btn = document.getElementById('mobileMenuBtn');
  const backdrop = ensureMobileMenuBackdrop();
  if (!menu) return;
  menu.classList.toggle('show', !!open);
  menu.setAttribute('aria-hidden', open ? 'false' : 'true');
  backdrop?.classList.toggle('show', !!open);
  if (btn) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = open ? 'fas fa-times' : 'fas fa-bars';
    }
  }
  document.body.classList.toggle('mobile-menu-open', !!open);
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const willOpen = !menu?.classList.contains('show');
  setMobileMenuOpen(willOpen);
}

/**
 * Wire header user menu + mobile hamburger. Safe to call multiple times.
 */
function initCommonNav() {
  if (_commonNavReady) return;
  _commonNavReady = true;

  // Event delegation: works even if the button is re-rendered
  document.addEventListener('click', (e) => {
    const mobileBtn = e.target.closest('#mobileMenuBtn');
    if (mobileBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileMenu();
      return;
    }

    if (!e.target.closest('.user-menu')) {
      document.getElementById('userDropdown')?.classList.remove('show');
    }
  });

  document.getElementById('userMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('userDropdown')?.classList.toggle('show');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  const mobileBtn = document.getElementById('mobileMenuBtn');
  if (mobileBtn) {
    mobileBtn.setAttribute('aria-controls', 'mobileMenu');
    mobileBtn.setAttribute('aria-expanded', 'false');
  }

  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu) {
    mobileMenu.setAttribute('aria-hidden', 'true');
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMobileMenuOpen(false);
    });
  }

  ensureMobileMenuBackdrop();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setMobileMenuOpen(false);
      document.getElementById('userDropdown')?.classList.remove('show');
    }
  });

  const header = document.querySelector('.header');
  if (header) {
    const onScroll = () => {
      const compact = window.scrollY > 12;
      header.classList.toggle('is-scrolled', compact);
      document.body.classList.toggle('header-compact', compact);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}

/**
 * Homepage-style footer HTML used on every page.
 */
function getSiteFooterHtml() {
  const year = new Date().getFullYear();
  return `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-section">
          <h3 class="footer-logo">
            <span class="logo-mark" style="width:32px;height:32px;font-size:0.85rem;border-radius:9px">J</span>
            JobsHub
          </h3>
          <p>A smarter way to discover work that feels right — curated listings, clear details, zero noise.</p>
        </div>
        <div class="footer-section">
          <h4>For you</h4>
          <ul>
            <li><a href="/">Browse jobs</a></li>
            <li><a href="/categories">Explore paths</a></li>
            <li><a href="/alerts">Job alerts</a></li>
            <li><a href="/profile">Profile</a></li>
            <li><a href="/register">Create account</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h4>Company</h4>
          <ul>
            <li><a href="/about">About us</a></li>
            <li><a href="/login">Sign in</a></li>
            <li><a href="/forgot-password">Forgot password</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h4>Legal</h4>
          <ul>
            <li><a href="/privacy">Privacy</a></li>
            <li><a href="/terms">Terms</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; ${year} JobsHub. Built for people who care about their next move.</p>
        <div class="social-links">
          <a href="#" aria-label="Twitter"><i class="fab fa-twitter"></i></a>
          <a href="#" aria-label="LinkedIn"><i class="fab fa-linkedin"></i></a>
        </div>
      </div>
    </div>
  `;
}

/**
 * Normalize all page footers to the homepage layout.
 * Targets footer.footer or [data-site-footer].
 */
function injectSiteFooter() {
  const footers = document.querySelectorAll('footer.footer, footer[data-site-footer]');
  if (!footers.length) return;
  const html = getSiteFooterHtml();
  footers.forEach((el) => {
    el.classList.add('footer');
    el.removeAttribute('data-site-footer');
    el.innerHTML = html;
  });
}

/**
 * Register PWA service worker (HTTPS or localhost).
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  if (location.protocol !== 'https:' && !isLocal) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err.message);
    });
  });
}

// Expose for pages that share helpers
window.setMobileMenuOpen = setMobileMenuOpen;
window.toggleMobileMenu = toggleMobileMenu;
window.initCommonNav = initCommonNav;
window.injectSiteFooter = injectSiteFooter;
window.registerServiceWorker = registerServiceWorker;

function bootCommon() {
  initCommonNav();
  injectSiteFooter();
  registerServiceWorker();
}

// Always attach nav + footer + PWA when common.js is present
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCommon);
} else {
  bootCommon();
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CATEGORY_ICONS = {
  code: 'fa-code',
  palette: 'fa-palette',
  megaphone: 'fa-bullhorn',
  'chart-line': 'fa-chart-line',
  headset: 'fa-headset',
  calculator: 'fa-calculator',
  users: 'fa-users',
  'chart-bar': 'fa-chart-bar',
  server: 'fa-server',
  lightbulb: 'fa-lightbulb',
  cogs: 'fa-cogs',
  briefcase: 'fa-briefcase',
  heartbeat: 'fa-heartbeat',
  'graduation-cap': 'fa-graduation-cap',
  'hands-helping': 'fa-hands-helping',
  'balance-scale': 'fa-balance-scale',
  utensils: 'fa-utensils',
  'hard-hat': 'fa-hard-hat',
  tools: 'fa-tools',
  industry: 'fa-industry',
  seedling: 'fa-seedling',
  truck: 'fa-truck',
  'shopping-bag': 'fa-shopping-bag',
  newspaper: 'fa-newspaper',
  landmark: 'fa-landmark',
  flask: 'fa-flask',
};

function categoryIconClass(icon) {
  return CATEGORY_ICONS[icon] || 'fa-folder';
}

/** Shared favicon + font head helpers used by pages that load common late */
function ensurePremiumMeta() {
  // no-op placeholder for future shared bootstrapping
}
