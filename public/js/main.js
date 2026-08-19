/**
 * JobsHub — Premium career discovery client
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
    county: '',
    source_type: '',
    kenya_only: false,
  },
  sort: 'posted_date',
  order: 'desc',
  savedIds: new Set(),
  facets: { counties: [], source_types: [], kenya_jobs: 0 },
};

// ============================================
// API
// ============================================

async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token && { Authorization: `Bearer ${state.token}` }),
    ...(options.headers || {}),
  };

  const config = { ...options, headers };
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
    throw err;
  }

  return data;
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSalary(min, max, currency = 'KES', period = 'monthly') {
  const formatter = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency || 'KES',
    maximumFractionDigits: 0,
  });

  if (min && max) {
    return `${formatter.format(min)} – ${formatter.format(max)}`;
  }
  if (min) return `From ${formatter.format(min)}`;
  if (max) return `Up to ${formatter.format(max)}`;
  return null;
}

function getJobTypeLabel(type) {
  const labels = {
    remote: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On-site',
  };
  return labels[type] || type || 'On-site';
}

function sourceTypeLabel(type) {
  const t = String(type || '').toUpperCase();
  const map = {
    DIRECT: 'Verified employer',
    COMPANY_CAREER: 'Company site',
    GOVERNMENT: 'Government',
    NGO: 'NGO',
    RECRUITMENT_AGENCY: 'Recruiter',
    BOARD: 'Job board',
    API: 'Aggregated',
    PARTNER: 'Partner',
    USER_SUBMITTED: 'Community',
  };
  return map[t] || (t ? t.replace(/_/g, ' ') : '');
}

function verificationBadge(job) {
  const v = String(job.verification_status || '').toLowerCase();
  const st = String(job.source_type || '').toUpperCase();
  if (v === 'verified' || st === 'DIRECT') {
    return '<span class="job-tag badge-verified" title="Posted by a verified employer">Verified</span>';
  }
  if (st === 'GOVERNMENT') {
    return '<span class="job-tag badge-gov">Public sector</span>';
  }
  if (st === 'NGO') {
    return '<span class="job-tag badge-ngo">NGO</span>';
  }
  if (st === 'COMPANY_CAREER') {
    return '<span class="job-tag badge-career">Company site</span>';
  }
  if (job.country_code === 'KE' || job.county) {
    return '<span class="job-tag badge-ke">Kenya</span>';
  }
  return '';
}

function logoHue(name) {
  if (!name) return 0;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % 6;
  return h;
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

  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.innerHTML = `<i class="fas fa-${icons[type] || icons.info}"></i> <span>${escapeHtml(message)}</span>`;
  host.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    el.style.transition = 'all 0.25s ease';
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// ============================================
// AUTH
// ============================================

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
    if (userName) userName.textContent = display;
    if (userAvatar) userAvatar.textContent = display.charAt(0).toUpperCase();
    if (mobileAuth) {
      mobileAuth.innerHTML = `
        <a href="/alerts" class="btn btn-ghost btn-block">Your alerts</a>
        <button type="button" class="btn btn-primary btn-block" id="mobileLogoutBtn">Sign out</button>
      `;
      document.getElementById('mobileLogoutBtn')?.addEventListener('click', logout);
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
}

// ============================================
// JOB CARDS
// ============================================

function createJobCard(job) {
  const jobTypeClass = job.job_type || 'onsite';
  const logoPlaceholder = escapeHtml((job.company_name || '?').charAt(0).toUpperCase());
  const hue = logoHue(job.company_name);
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period);
  const title = escapeHtml(job.title);
  const company = escapeHtml(job.company_name);
  const locParts = [job.county, job.location].filter(Boolean);
  const uniqueLoc = [...new Set(locParts.map((s) => String(s).trim()))].join(' · ') || 'Location flexible';
  const location = escapeHtml(uniqueLoc);
  const category = job.category_name ? escapeHtml(job.category_name) : '';
  const isSaved = state.savedIds.has(String(job.id));
  const sourceBadge = verificationBadge(job);

  const logoHtml = job.company_logo_url
    ? `<img src="${escapeHtml(job.company_logo_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'job-logo-placeholder hue-${hue}',textContent:'${logoPlaceholder}'}))">`
    : `<span class="job-logo-placeholder hue-${hue}">${logoPlaceholder}</span>`;

  return `
    <article class="job-card ${job.is_featured ? 'featured' : ''}" data-job-id="${escapeHtml(job.id)}" tabindex="0" role="button" aria-label="${title} at ${company}">
      <div class="job-card-header">
        <div class="job-logo">${logoHtml}</div>
        <div class="job-info">
          <h3 class="job-title">${title}</h3>
          <p class="job-company">
            <i class="fas fa-building" aria-hidden="true"></i>
            ${company}
          </p>
        </div>
        <button type="button" class="job-save-btn ${isSaved ? 'saved' : ''}" data-save-job="${escapeHtml(job.id)}" aria-label="Save job" title="Save">
          <i class="${isSaved ? 'fas' : 'far'} fa-bookmark"></i>
        </button>
      </div>

      <div class="job-meta">
        <span class="job-meta-item">
          <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
          ${location}
        </span>
        ${category ? `
          <span class="job-meta-item">
            <i class="fas fa-layer-group" aria-hidden="true"></i>
            ${category}
          </span>
        ` : ''}
      </div>

      <div class="job-tags">
        <span class="job-tag ${jobTypeClass}">${getJobTypeLabel(job.job_type)}</span>
        ${sourceBadge}
        ${job.is_featured ? '<span class="job-tag featured">Featured</span>' : ''}
        ${job.is_new ? '<span class="job-tag new">New</span>' : ''}
        ${job.expiring_soon ? '<span class="job-tag expiring">Closing soon</span>' : ''}
      </div>

      <div class="job-footer">
        <span class="job-salary ${salary ? '' : 'is-unspecified'}">${salary || 'Salary on request'}</span>
        <span class="job-posted">${formatDate(job.posted_date)}</span>
        <span class="job-card-cta">View role <i class="fas fa-arrow-right"></i></span>
      </div>
    </article>
  `;
}

function skeletonCards(count = 6) {
  return Array.from({ length: count }, () => `
    <div class="job-card-skeleton" aria-hidden="true">
      <div style="display:flex;gap:1rem;margin-bottom:1rem">
        <div class="skeleton skeleton-logo"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-line h-title"></div>
          <div class="skeleton skeleton-line w-40"></div>
        </div>
      </div>
      <div class="skeleton skeleton-line w-55"></div>
      <div class="skeleton skeleton-line w-30" style="margin-top:0.75rem"></div>
    </div>
  `).join('');
}

function renderJobs(jobs, containerId = 'jobsList') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!jobs || jobs.length === 0) {
    const cat = state.filters?.category;
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-compass"></i></div>
        <h3>${cat ? 'No open roles in this category' : 'Nothing perfect yet'}</h3>
        <p>${
          cat
            ? 'This field has 0 matching jobs right now. Try another category or browse everything.'
            : 'Try widening your search — your next opportunity might be one filter away.'
        }</p>
        <button type="button" class="btn btn-primary" id="emptyClearBtn">${cat ? 'Browse all jobs' : 'Reset filters'}</button>
      </div>
    `;
    document.getElementById('emptyClearBtn')?.addEventListener('click', clearFilters);
    return;
  }

  container.innerHTML = jobs.map((job) => createJobCard(job)).join('');
  bindJobCardEvents(container);
}

function bindJobCardEvents(container) {
  container.querySelectorAll('.job-card').forEach((card) => {
    const open = () => openJobModal(card.dataset.jobId);
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-save-job]')) return;
      open();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });

  container.querySelectorAll('[data-save-job]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveJob(btn.dataset.saveJob, btn);
    });
  });
}

function renderPagination(pagination) {
  const container = document.getElementById('pagination');
  if (!container) return;

  const { page, totalPages, hasNext, hasPrev } = pagination;

  if (!totalPages || totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `<button class="pagination-btn" type="button" ${!hasPrev ? 'disabled' : ''} data-page="${page - 1}" aria-label="Previous">
    <i class="fas fa-chevron-left"></i>
  </button>`;

  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

  if (start > 1) {
    html += `<button class="pagination-btn" type="button" data-page="1">1</button>`;
    if (start > 2) html += `<span class="pagination-btn" style="pointer-events:none;border:none;background:transparent">…</span>`;
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="pagination-btn ${i === page ? 'active' : ''}" type="button" data-page="${i}">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += `<span class="pagination-btn" style="pointer-events:none;border:none;background:transparent">…</span>`;
    html += `<button class="pagination-btn" type="button" data-page="${totalPages}">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" type="button" ${!hasNext ? 'disabled' : ''} data-page="${page + 1}" aria-label="Next">
    <i class="fas fa-chevron-right"></i>
  </button>`;

  container.innerHTML = html;
  container.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!Number.isNaN(p)) changePage(p);
    });
  });
}

// ============================================
// LOAD DATA
// ============================================

async function loadFeaturedJobs() {
  const container = document.getElementById('featuredJobs');
  if (!container) return;

  container.innerHTML = skeletonCards(3);

  try {
    const response = await api('/jobs/featured');
    const jobs = response.data || [];

    if (jobs.length === 0) {
      document.getElementById('featuredSection')?.classList.add('hidden');
      return;
    }

    container.innerHTML = jobs.map((job) => createJobCard(job)).join('');
    bindJobCardEvents(container);
  } catch (error) {
    console.error('Failed to load featured jobs:', error);
    document.getElementById('featuredSection')?.classList.add('hidden');
  }
}

async function loadJobs() {
  const list = document.getElementById('jobsList');
  if (list) list.innerHTML = skeletonCards(5);

  try {
    const params = new URLSearchParams();
    params.append('page', state.currentPage);
    params.append('sort', state.sort);
    params.append('order', state.order);

    if (state.filters.search) params.append('search', state.filters.search);
    if (state.filters.location) params.append('location', state.filters.location);
    if (state.filters.category) params.append('category', state.filters.category);
    if (state.filters.job_type.length) params.append('job_type', state.filters.job_type.join(','));
    if (state.filters.posted_after) params.append('posted_after', state.filters.posted_after);
    if (state.filters.salary_min) params.append('salary_min', state.filters.salary_min);
    if (state.filters.salary_max) params.append('salary_max', state.filters.salary_max);
    if (state.filters.county) params.append('county', state.filters.county);
    if (state.filters.source_type) params.append('source_type', state.filters.source_type);
    if (state.filters.kenya_only) params.append('kenya_only', 'true');

    const response = await api(`/jobs?${params.toString()}`);
    const jobs = response.data?.jobs || response.data || [];
    const pagination = response.data?.pagination || { page: 1, totalPages: 1, total: jobs.length };

    renderJobs(jobs);
    renderPagination(pagination);

    const jobsCount = document.getElementById('jobsCount');
    if (jobsCount) jobsCount.textContent = pagination.total ?? jobs.length;

    const statJobs = document.getElementById('statJobs');
    if (statJobs && !state.filters.search && !state.filters.location && !state.filters.category) {
      const n = pagination.total ?? jobs.length;
      statJobs.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    }
  } catch (error) {
    console.error('Failed to load jobs:', error);
    if (list) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fas fa-cloud"></i></div>
          <h3>Couldn’t load opportunities</h3>
          <p>Please check your connection and try again.</p>
          <button type="button" class="btn btn-primary" onclick="loadJobs()">Retry</button>
        </div>
      `;
    }
    showNotification('Failed to load jobs. Please try again.', 'error');
  }
}

async function loadCategories() {
  try {
    const response = await api('/categories');
    const categories = response.data || [];

    // Sidebar filters
    const container = document.getElementById('categoryFilters');
    if (container) {
      const selected = state.filters.category;
      container.innerHTML = categories
        .map((cat) => {
          const checked =
            selected && (selected === cat.id || selected === cat.slug) ? 'checked' : '';
          return `
            <label class="filter-checkbox">
              <input type="checkbox" name="category" value="${escapeHtml(cat.slug)}" ${checked}>
              <span class="checkmark"></span>
              ${escapeHtml(cat.name)}
              <span style="margin-left:auto;color:var(--muted-2);font-size:0.75rem">${cat.job_count || 0}</span>
            </label>
          `;
        })
        .join('');
    }

    // Discovery chips
    const chips = document.getElementById('discoveryChips');
    if (chips) {
      const top = categories.slice(0, 12);
      chips.innerHTML = top
        .map((cat) => {
          const iconMap = {
            code: 'fa-code',
            palette: 'fa-palette',
            megaphone: 'fa-bullhorn',
            'chart-line': 'fa-chart-line',
            headset: 'fa-headset',
            calculator: 'fa-calculator',
            users: 'fa-users',
            server: 'fa-server',
            lightbulb: 'fa-lightbulb',
            cogs: 'fa-cogs',
            briefcase: 'fa-briefcase',
            heartbeat: 'fa-heartbeat',
          };
          const icon = iconMap[cat.icon] || 'fa-folder';
          return `
            <a href="/?category=${encodeURIComponent(cat.slug)}#exploreSection" class="discovery-chip" data-category="${escapeHtml(cat.slug)}">
              <span class="discovery-chip-icon"><i class="fas ${icon}"></i></span>
              ${escapeHtml(cat.name)}
            </a>
          `;
        })
        .join('');

      chips.querySelectorAll('[data-category]').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          // Allow default for new page; if already on home with SPA-like, handle inline
          if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
            e.preventDefault();
            state.filters.category = chip.dataset.category;
            state.currentPage = 1;
            // Sync sidebar
            document.querySelectorAll('input[name="category"]').forEach((cb) => {
              cb.checked = cb.value === state.filters.category;
            });
            loadJobs();
            updateURL();
            document.getElementById('exploreSection')?.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });
    }

    // Rough company stat from category variety
    const statCompanies = document.getElementById('statCompanies');
    if (statCompanies && categories.length) {
      const estimate = Math.max(categories.reduce((s, c) => s + (Number(c.job_count) || 0), 0), categories.length);
      // Use category count as proxy if we don't have company count
      statCompanies.textContent = `${categories.length}+`;
      // Prefer a nicer number from jobs if available later
      void estimate;
    }
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

// ============================================
// JOB DETAIL
// ============================================

async function openJobModal(jobId) {
  const modal = document.getElementById('jobModal');
  const jobDetail = document.getElementById('jobDetail');
  if (!modal || !jobDetail) return;

  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  jobDetail.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    api(`/jobs/${jobId}/view`, { method: 'POST' }).catch(() => {});

    const response = await api(`/jobs/${jobId}`);
    const job = response.data.job || response.data;
    const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period);
    const hue = logoHue(job.company_name);
    const letter = escapeHtml((job.company_name || '?').charAt(0).toUpperCase());

    const logoBlock = job.company_logo_url
      ? `<img src="${escapeHtml(job.company_logo_url)}" alt="">`
      : `<div class="job-logo-placeholder hue-${hue}" style="width:100%;height:100%;border-radius:inherit;font-size:1.5rem">${letter}</div>`;

    jobDetail.innerHTML = `
      <div class="job-detail-header">
        <div class="job-detail-logo">${logoBlock}</div>
        <div class="job-detail-info">
          <h1 id="jobDetailTitle">${escapeHtml(job.title)}</h1>
          <p class="job-detail-company">${escapeHtml(job.company_name)}</p>
          <div class="job-detail-meta">
            <span class="job-meta-item"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(job.location || 'Flexible')}</span>
            <span class="job-meta-item"><i class="fas fa-briefcase"></i> ${getJobTypeLabel(job.job_type)}</span>
            ${job.category_name ? `<span class="job-meta-item"><i class="fas fa-layer-group"></i> ${escapeHtml(job.category_name)}</span>` : ''}
            <span class="job-meta-item"><i class="fas fa-clock"></i> ${formatDate(job.posted_date)}</span>
          </div>
        </div>
      </div>

      ${salary ? `
        <div class="job-detail-section">
          <h2><i class="fas fa-coins"></i> Compensation</h2>
          <p class="job-detail-content" style="font-size:1.25rem;font-weight:800;color:var(--mint);letter-spacing:-0.02em">
            ${salary}${job.salary_period ? ` <span style="font-size:0.85rem;font-weight:600;color:var(--muted)">/ ${escapeHtml(job.salary_period)}</span>` : ''}
          </p>
        </div>
      ` : ''}

      <div class="job-detail-section">
        <h2><i class="fas fa-align-left"></i> About the role</h2>
        <div class="job-detail-content">${job.description || ''}</div>
      </div>

      ${job.requirements ? `
        <div class="job-detail-section">
          <h2><i class="fas fa-list-check"></i> What you’ll need</h2>
          <div class="job-detail-content">${job.requirements}</div>
        </div>
      ` : ''}

      ${job.benefits ? `
        <div class="job-detail-section">
          <h2><i class="fas fa-gift"></i> Benefits</h2>
          <div class="job-detail-content">${job.benefits}</div>
        </div>
      ` : ''}

      <div class="job-detail-actions">
        <button class="btn btn-outline" type="button" data-modal-save="${escapeHtml(job.id)}">
          <i class="far fa-bookmark"></i> Save for later
        </button>
        <a href="${escapeHtml(job.external_link || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-apply" data-track-click="${escapeHtml(job.id)}">
          Apply at ${escapeHtml(job.company_name || 'company')}
          <i class="fas fa-external-link-alt"></i>
        </a>
      </div>

      ${response.data.relatedJobs?.length > 0 ? `
        <div class="job-detail-section" style="margin-top:2rem">
          <h2><i class="fas fa-star"></i> Similar roles</h2>
          <div class="jobs-grid" style="margin-top:1rem" id="relatedJobsGrid">
            ${response.data.relatedJobs.map((j) => createJobCard(j)).join('')}
          </div>
        </div>
      ` : ''}
    `;

    jobDetail.querySelector('[data-modal-save]')?.addEventListener('click', (e) => {
      saveJob(e.currentTarget.dataset.modalSave, e.currentTarget);
    });
    jobDetail.querySelector('[data-track-click]')?.addEventListener('click', () => {
      trackClick(job.id);
    });
    const related = document.getElementById('relatedJobsGrid');
    if (related) bindJobCardEvents(related);
  } catch (error) {
    jobDetail.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-exclamation"></i></div>
        <h3>Couldn’t open this role</h3>
        <p>Please try again in a moment.</p>
      </div>
    `;
  }
}

function closeJobModal() {
  const modal = document.getElementById('jobModal');
  modal?.classList.remove('show');
  document.body.style.overflow = '';
}

async function saveJob(jobId, btnEl) {
  if (!state.token) {
    showNotification('Sign in to build your shortlist', 'warning');
    setTimeout(() => {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
    }, 800);
    return;
  }

  try {
    await api(`/users/saved-jobs/${jobId}`, { method: 'POST' });
    state.savedIds.add(String(jobId));
    showNotification('Added to your shortlist', 'success');

    if (btnEl) {
      btnEl.classList.add('saved');
      const icon = btnEl.querySelector('i');
      if (icon) {
        icon.classList.remove('far');
        icon.classList.add('fas');
      }
      btnEl.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.2)' },
          { transform: 'scale(1)' },
        ],
        { duration: 280, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)' }
      );
    }
  } catch (error) {
    showNotification(error.message || 'Couldn’t save that role', 'error');
  }
}

function trackClick(jobId) {
  api(`/jobs/${jobId}/click`, { method: 'POST' }).catch(() => {});
}

// ============================================
// SEARCH & FILTERS
// ============================================

function handleSearch() {
  const searchInput = document.getElementById('searchInput');
  const locationInput = document.getElementById('locationInput');

  state.filters.search = searchInput?.value.trim() || '';
  state.filters.location = locationInput?.value.trim() || '';
  state.currentPage = 1;

  loadJobs();
  updateURL();
  document.getElementById('exploreSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleQuickFilter(filter, btn) {
  document.querySelectorAll('.quick-filter').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');

  if (filter === 'all') {
    state.filters.job_type = [];
  } else {
    state.filters.job_type = [filter];
  }
  state.currentPage = 1;

  // Sync sidebar checkboxes
  document.querySelectorAll('input[name="job_type"]').forEach((cb) => {
    cb.checked = state.filters.job_type.includes(cb.value);
  });

  loadJobs();
  updateURL();
}

function applyFilters() {
  const categoryCheckboxes = document.querySelectorAll('input[name="category"]:checked');
  state.filters.category = categoryCheckboxes.length > 0 ? categoryCheckboxes[0].value : '';

  // Single-select categories: uncheck others on click is handled loosely
  const jobTypeCheckboxes = document.querySelectorAll('input[name="job_type"]:checked');
  state.filters.job_type = Array.from(jobTypeCheckboxes).map((cb) => cb.value);

  const dateRadio = document.querySelector('input[name="posted_after"]:checked');
  state.filters.posted_after = dateRadio?.value || '';

  state.filters.salary_min = document.getElementById('salaryMin')?.value || '';
  state.filters.salary_max = document.getElementById('salaryMax')?.value || '';

  const countySel = document.getElementById('countyFilter');
  state.filters.county = countySel?.value || '';

  const sourceSel = document.getElementById('sourceTypeFilter');
  state.filters.source_type = sourceSel?.value || '';

  const kenyaCb = document.getElementById('kenyaOnlyFilter');
  state.filters.kenya_only = Boolean(kenyaCb?.checked);

  state.currentPage = 1;
  loadJobs();
  updateURL();
  closeFiltersSheet();
}

function clearFilters() {
  state.filters = {
    search: '',
    location: '',
    category: '',
    job_type: [],
    posted_after: '',
    salary_min: '',
    salary_max: '',
    county: '',
    source_type: '',
    kenya_only: false,
  };
  state.currentPage = 1;

  document.querySelectorAll('.filters-sidebar input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  document.querySelectorAll('.filters-sidebar input[type="radio"]').forEach((rb) => {
    rb.checked = rb.value === '';
  });
  const sMin = document.getElementById('salaryMin');
  const sMax = document.getElementById('salaryMax');
  if (sMin) sMin.value = '';
  if (sMax) sMax.value = '';
  const search = document.getElementById('searchInput');
  const loc = document.getElementById('locationInput');
  if (search) search.value = '';
  if (loc) loc.value = '';
  const countySel = document.getElementById('countyFilter');
  const sourceSel = document.getElementById('sourceTypeFilter');
  if (countySel) countySel.value = '';
  if (sourceSel) sourceSel.value = '';

  document.querySelectorAll('.quick-filter').forEach((btn) => btn.classList.remove('active'));
  document.querySelector('.quick-filter[data-filter="all"]')?.classList.add('active');
  document.querySelectorAll('.kenya-chip').forEach((btn) => btn.classList.remove('active'));

  loadJobs();
  updateURL();
  closeFiltersSheet();
}

function changePage(page) {
  state.currentPage = page;
  loadJobs();
  updateURL();
  document.querySelector('.jobs-main')?.scrollIntoView({ behavior: 'smooth' });
}

function handleSort(sortValue) {
  state.sort = sortValue;
  state.currentPage = 1;
  loadJobs();
}

function updateURL() {
  const params = new URLSearchParams();

  if (state.filters.search) params.set('q', state.filters.search);
  if (state.filters.location) params.set('location', state.filters.location);
  if (state.filters.category) params.set('category', state.filters.category);
  if (state.filters.job_type.length) params.set('type', state.filters.job_type.join(','));
  if (state.filters.posted_after) params.set('posted', state.filters.posted_after);
  if (state.filters.county) params.set('county', state.filters.county);
  if (state.filters.source_type) params.set('source_type', state.filters.source_type);
  if (state.filters.kenya_only) params.set('kenya', '1');
  if (state.currentPage > 1) params.set('page', state.currentPage);

  const newURL = params.toString() ? `?${params.toString()}` : window.location.pathname;
  history.pushState(null, '', newURL);
}

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);

  state.filters.search = params.get('q') || '';
  state.filters.location = params.get('location') || '';
  state.filters.category = params.get('category') || '';
  state.filters.job_type = params.get('type')?.split(',').filter(Boolean) || [];
  state.filters.posted_after = params.get('posted') || '';
  state.filters.county = params.get('county') || '';
  state.filters.source_type = params.get('source_type') || '';
  state.filters.kenya_only = params.get('kenya') === '1' || params.get('kenya') === 'true';
  state.currentPage = parseInt(params.get('page'), 10) || 1;

  const searchEl = document.getElementById('searchInput');
  const locEl = document.getElementById('locationInput');
  if (searchEl) searchEl.value = state.filters.search;
  if (locEl) locEl.value = state.filters.location;

  const countySel = document.getElementById('countyFilter');
  const sourceSel = document.getElementById('sourceTypeFilter');
  const kenyaCb = document.getElementById('kenyaOnlyFilter');
  if (countySel && state.filters.county) countySel.value = state.filters.county;
  if (sourceSel && state.filters.source_type) sourceSel.value = state.filters.source_type;
  if (kenyaCb) kenyaCb.checked = state.filters.kenya_only;

  if (state.filters.job_type.length === 1) {
    document.querySelectorAll('.quick-filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === state.filters.job_type[0]);
    });
  }
}

async function loadFacets() {
  try {
    const res = await api('/jobs/meta/facets');
    state.facets = res.data || { counties: [], source_types: [], kenya_jobs: 0 };

    const countySel = document.getElementById('countyFilter');
    if (countySel) {
      const current = state.filters.county || countySel.value;
      const opts = ['<option value="">All counties</option>']
        .concat(
          (state.facets.counties || []).map(
            (c) =>
              `<option value="${escapeHtml(c.value)}" ${c.value === current ? 'selected' : ''}>${escapeHtml(c.value)} (${c.count})</option>`
          )
        );
      countySel.innerHTML = opts.join('');
    }

    const sourceSel = document.getElementById('sourceTypeFilter');
    if (sourceSel) {
      const current = state.filters.source_type || sourceSel.value;
      const opts = ['<option value="">All sources</option>']
        .concat(
          (state.facets.source_types || []).map(
            (s) =>
              `<option value="${escapeHtml(s.value)}" ${s.value === current ? 'selected' : ''}>${escapeHtml(sourceTypeLabel(s.value))} (${s.count})</option>`
          )
        );
      sourceSel.innerHTML = opts.join('');
    }

    const kenyaStat = document.getElementById('kenyaJobsCount');
    if (kenyaStat) kenyaStat.textContent = String(state.facets.kenya_jobs || 0);

    renderKenyaCountyChips();
  } catch (err) {
    console.warn('Facets unavailable', err);
  }
}

function renderKenyaCountyChips() {
  const host = document.getElementById('kenyaCountyChips');
  if (!host) return;
  const top = (state.facets.counties || []).slice(0, 8);
  if (!top.length) {
    host.innerHTML = '<span class="muted-hint">County filters appear as local jobs are ingested.</span>';
    return;
  }
  host.innerHTML = top
    .map(
      (c) =>
        `<button type="button" class="kenya-chip ${state.filters.county === c.value ? 'active' : ''}" data-county="${escapeHtml(c.value)}">${escapeHtml(c.value)} <em>${c.count}</em></button>`
    )
    .join('');
  host.querySelectorAll('.kenya-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const county = btn.dataset.county;
      state.filters.county = state.filters.county === county ? '' : county;
      state.filters.kenya_only = true;
      state.currentPage = 1;
      const countySel = document.getElementById('countyFilter');
      const kenyaCb = document.getElementById('kenyaOnlyFilter');
      if (countySel) countySel.value = state.filters.county;
      if (kenyaCb) kenyaCb.checked = true;
      host.querySelectorAll('.kenya-chip').forEach((b) => b.classList.toggle('active', b.dataset.county === state.filters.county));
      loadJobs();
      updateURL();
      document.getElementById('exploreSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function applyKenyaPreset(kind) {
  state.filters.kenya_only = true;
  state.filters.source_type = '';
  state.filters.county = '';
  if (kind === 'government') state.filters.source_type = 'GOVERNMENT';
  if (kind === 'ngo') state.filters.source_type = 'NGO';
  if (kind === 'nairobi') state.filters.county = 'Nairobi';
  // kind === 'all' keeps kenya_only only
  state.currentPage = 1;
  const kenyaCb = document.getElementById('kenyaOnlyFilter');
  const sourceSel = document.getElementById('sourceTypeFilter');
  const countySel = document.getElementById('countyFilter');
  if (kenyaCb) kenyaCb.checked = true;
  if (sourceSel) sourceSel.value = state.filters.source_type;
  if (countySel) countySel.value = state.filters.county;
  loadJobs();
  updateURL();
  document.getElementById('exploreSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================
// FILTER SHEET (MOBILE)
// ============================================

function openFiltersSheet() {
  document.getElementById('filtersSidebar')?.classList.add('is-open');
  document.getElementById('filtersBackdrop')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeFiltersSheet() {
  document.getElementById('filtersSidebar')?.classList.remove('is-open');
  document.getElementById('filtersBackdrop')?.classList.remove('show');
  if (!document.getElementById('jobModal')?.classList.contains('show')) {
    document.body.style.overflow = '';
  }
}

// ============================================
// MOBILE NAV (when common.js is not loaded)
// ============================================

function initStandaloneMobileNav() {
  if (window.__standaloneNavReady) return;
  window.__standaloneNavReady = true;

  const ensureBackdrop = () => {
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
    backdrop.addEventListener('click', () => setStandaloneMenuOpen(false));
    return backdrop;
  };

  function setStandaloneMenuOpen(open) {
    const menu = document.getElementById('mobileMenu');
    const btn = document.getElementById('mobileMenuBtn');
    const backdrop = ensureBackdrop();
    if (!menu) return;
    menu.classList.toggle('show', !!open);
    backdrop?.classList.toggle('show', !!open);
    document.body.classList.toggle('mobile-menu-open', !!open);
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const icon = btn.querySelector('i');
      if (icon) icon.className = open ? 'fas fa-times' : 'fas fa-bars';
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#mobileMenuBtn')) {
      e.preventDefault();
      e.stopPropagation();
      const menu = document.getElementById('mobileMenu');
      setStandaloneMenuOpen(!menu?.classList.contains('show'));
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

  document.getElementById('mobileMenu')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setStandaloneMenuOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setStandaloneMenuOpen(false);
      document.getElementById('userDropdown')?.classList.remove('show');
    }
  });

  const header = document.getElementById('siteHeader') || document.querySelector('.header');
  if (header) {
    const onScroll = () => {
      const compact = window.scrollY > 12;
      header.classList.toggle('is-scrolled', compact);
      document.body.classList.toggle('header-compact', compact);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  ensureBackdrop();
}

// ============================================
// EVENTS
// ============================================

function initEventListeners() {
  document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
  document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
  document.getElementById('locationInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  document.querySelectorAll('.quick-filter').forEach((btn) => {
    btn.addEventListener('click', () => handleQuickFilter(btn.dataset.filter, btn));
  });

  document.getElementById('applyFilters')?.addEventListener('click', applyFilters);
  document.getElementById('clearFilters')?.addEventListener('click', clearFilters);
  document.getElementById('openFiltersBtn')?.addEventListener('click', openFiltersSheet);
  document.getElementById('bottomFilterBtn')?.addEventListener('click', openFiltersSheet);
  document.getElementById('filtersClose')?.addEventListener('click', closeFiltersSheet);
  document.getElementById('filtersBackdrop')?.addEventListener('click', closeFiltersSheet);

  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    handleSort(e.target.value);
  });

  document.getElementById('modalOverlay')?.addEventListener('click', closeJobModal);
  document.getElementById('modalClose')?.addEventListener('click', closeJobModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeJobModal();
      closeFiltersSheet();
    }
  });

  // Header / hamburger — prefer shared common.js; fall back for standalone index
  if (typeof window.initCommonNav === 'function') {
    window.initCommonNav();
  } else {
    initStandaloneMobileNav();
  }

  window.addEventListener('popstate', () => {
    loadFromURL();
    loadJobs();
  });

  // Category filter: only one category at a time
  document.getElementById('categoryFilters')?.addEventListener('change', (e) => {
    if (e.target.name === 'category' && e.target.checked) {
      document.querySelectorAll('input[name="category"]').forEach((cb) => {
        if (cb !== e.target) cb.checked = false;
      });
    }
  });
}

// ============================================
// INIT
// ============================================

function injectHomeFooter() {
  if (typeof window.injectSiteFooter === 'function') {
    window.injectSiteFooter();
    return;
  }
  const footer = document.querySelector('footer.footer, footer[data-site-footer]');
  if (!footer) return;
  const year = new Date().getFullYear();
  footer.classList.add('footer');
  footer.innerHTML = `
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

function registerPwa() {
  if (typeof window.registerServiceWorker === 'function') {
    window.registerServiceWorker();
    return;
  }
  if (!('serviceWorker' in navigator)) return;
  const isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]';
  if (location.protocol !== 'https:' && !isLocal) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

async function init() {
  injectHomeFooter();
  registerPwa();
  initEventListeners();
  loadFromURL();
  await checkAuth();

  await Promise.all([loadFeaturedJobs(), loadJobs(), loadCategories(), loadFacets()]);

  if (window.location.hash === '#exploreSection') {
    document.getElementById('exploreSection')?.scrollIntoView({ behavior: 'smooth' });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for inline handlers if any remain
window.openJobModal = openJobModal;
window.loadJobs = loadJobs;
window.changePage = changePage;
window.saveJob = saveJob;
window.trackClick = trackClick;
window.applyKenyaPreset = applyKenyaPreset;
