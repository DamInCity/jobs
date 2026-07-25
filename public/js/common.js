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
  const notification = document.createElement('div');
  notification.className = `alert alert-${type}`;
  notification.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
  notification.style.cssText =
    'position: fixed; top: 80px; right: 20px; z-index: 1000; min-width: 300px; max-width: 420px; animation: slideIn 0.3s ease; box-shadow: var(--shadow-lg);';
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3500);
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
  const mobileAuth = document.getElementById('mobileAuth');

  if (isLoggedIn && state.user) {
    authButtons?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (userName) {
      userName.textContent = state.user.name || state.user.email.split('@')[0];
    }
    if (mobileAuth) {
      mobileAuth.innerHTML = `
        <a href="/alerts" class="btn btn-ghost btn-block">Job Alerts</a>
        <a href="/saved-jobs" class="btn btn-ghost btn-block">Saved Jobs</a>
        <button type="button" class="btn btn-primary btn-block" id="mobileLogoutBtn">Sign Out</button>
      `;
      document.getElementById('mobileLogoutBtn')?.addEventListener('click', logout);
    }
  } else {
    authButtons?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    if (mobileAuth) {
      mobileAuth.innerHTML = `
        <a href="/login" class="btn btn-ghost btn-block">Sign In</a>
        <a href="/register" class="btn btn-primary btn-block">Sign Up</a>
      `;
    }
  }
}

function logout() {
  localStorage.removeItem('token');
  state.token = null;
  state.user = null;
  updateAuthUI(false);
  showNotification('You have been logged out', 'success');
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

function initCommonNav() {
  document.getElementById('userMenuBtn')?.addEventListener('click', () => {
    document.getElementById('userDropdown')?.classList.toggle('show');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('mobileMenu')?.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) {
      document.getElementById('userDropdown')?.classList.remove('show');
    }
  });
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
