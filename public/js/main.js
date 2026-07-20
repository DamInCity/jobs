/**
 * JobsHub - Main JavaScript Application
 * Handles all client-side functionality for the jobs website
 */

// ============================================
// CONFIGURATION & STATE
// ============================================

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

// ============================================
// API HELPERS
// ============================================

async function api(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(state.token && { Authorization: `Bearer ${state.token}` }),
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Something went wrong');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSalary(min, max, currency = 'KES', period = 'monthly') {
  const formatter = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0,
  });

  if (min && max) {
    return `${formatter.format(min)} - ${formatter.format(max)}/${period}`;
  } else if (min) {
    return `From ${formatter.format(min)}/${period}`;
  } else if (max) {
    return `Up to ${formatter.format(max)}/${period}`;
  }
  return 'Salary not specified';
}

function getJobTypeLabel(type) {
  const labels = {
    remote: '🌍 Remote',
    hybrid: '🏢 Hybrid',
    onsite: '📍 On-site',
  };
  return labels[type] || type;
}

function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `alert alert-${type}`;
  notification.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
  notification.style.cssText = 'position: fixed; top: 80px; right: 20px; z-index: 1000; min-width: 300px; animation: slideIn 0.3s ease;';

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// ============================================
// AUTHENTICATION
// ============================================

async function checkAuth() {
  if (!state.token) {
    updateAuthUI(false);
    return;
  }

  try {
    const response = await api('/users/profile');
    state.user = response.data;
    updateAuthUI(true);
  } catch (error) {
    // Token invalid or expired
    localStorage.removeItem('token');
    state.token = null;
    state.user = null;
    updateAuthUI(false);
  }
}

function updateAuthUI(isLoggedIn) {
  const authButtons = document.getElementById('authButtons');
  const userMenu = document.getElementById('userMenu');
  const userName = document.getElementById('userName');

  if (isLoggedIn && state.user) {
    authButtons?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (userName) {
      userName.textContent = state.user.name || state.user.email.split('@')[0];
    }
  } else {
    authButtons?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
  }
}

function logout() {
  localStorage.removeItem('token');
  state.token = null;
  state.user = null;
  updateAuthUI(false);
  showNotification('You have been logged out', 'success');
}

// ============================================
// JOB RENDERING
// ============================================

function createJobCard(job, featured = false) {
  const jobTypeClass = job.job_type || 'onsite';
  const logoPlaceholder = job.company_name.charAt(0).toUpperCase();

  return `
    <article class="job-card ${job.is_featured ? 'featured' : ''}" data-job-id="${job.id}" onclick="openJobModal('${job.id}')">
      <div class="job-card-header">
        <div class="job-logo">
          ${job.company_logo_url 
            ? `<img src="${job.company_logo_url}" alt="${job.company_name} logo" onerror="this.parentElement.innerHTML='<span class=\\'job-logo-placeholder\\'>${logoPlaceholder}</span>'">` 
            : `<span class="job-logo-placeholder">${logoPlaceholder}</span>`
          }
        </div>
        <div class="job-info">
          <h3 class="job-title">${job.title}</h3>
          <p class="job-company">
            <i class="fas fa-building"></i>
            ${job.company_name}
          </p>
        </div>
      </div>
      
      <div class="job-meta">
        <span class="job-meta-item">
          <i class="fas fa-map-marker-alt"></i>
          ${job.location}
        </span>
        ${job.category_name ? `
          <span class="job-meta-item">
            <i class="fas fa-folder"></i>
            ${job.category_name}
          </span>
        ` : ''}
      </div>
      
      <div class="job-tags">
        <span class="job-tag ${jobTypeClass}">${getJobTypeLabel(job.job_type)}</span>
        ${job.is_featured ? '<span class="job-tag featured">⭐ Featured</span>' : ''}
        ${job.is_new ? '<span class="job-tag new">New</span>' : ''}
        ${job.expiring_soon ? '<span class="job-tag expiring">Expiring Soon</span>' : ''}
      </div>
      
      <div class="job-footer">
        <span class="job-salary">${formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period)}</span>
        <span class="job-posted">${formatDate(job.posted_date)}</span>
      </div>
    </article>
  `;
}

function renderJobs(jobs, containerId = 'jobsList') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <h3>No jobs found</h3>
        <p>Try adjusting your search filters or check back later for new opportunities.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(job => createJobCard(job)).join('');
}

function renderPagination(pagination) {
  const container = document.getElementById('pagination');
  if (!container) return;

  const { page, totalPages, hasNext, hasPrev } = pagination;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `<button class="pagination-btn" ${!hasPrev ? 'disabled' : ''} onclick="changePage(${page - 1})">
    <i class="fas fa-chevron-left"></i>
  </button>`;

  // Page numbers
  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);

  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  if (start > 1) {
    html += `<button class="pagination-btn" onclick="changePage(1)">1</button>`;
    if (start > 2) {
      html += `<span class="pagination-btn" style="pointer-events: none;">...</span>`;
    }
  }

  for (let i = start; i <= end; i++) {
    html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
  }

  if (end < totalPages) {
    if (end < totalPages - 1) {
      html += `<span class="pagination-btn" style="pointer-events: none;">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `<button class="pagination-btn" ${!hasNext ? 'disabled' : ''} onclick="changePage(${page + 1})">
    <i class="fas fa-chevron-right"></i>
  </button>`;

  container.innerHTML = html;
}

// ============================================
// LOAD DATA
// ============================================

async function loadFeaturedJobs() {
  try {
    const response = await api('/jobs/featured');
    const container = document.getElementById('featuredJobs');
    
    if (response.data.length === 0) {
      document.getElementById('featuredSection')?.classList.add('hidden');
      return;
    }

    container.innerHTML = response.data.map(job => createJobCard(job, true)).join('');
  } catch (error) {
    console.error('Failed to load featured jobs:', error);
  }
}

async function loadJobs() {
  try {
    // Build query string from filters
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

    const response = await api(`/jobs?${params.toString()}`);
    
    renderJobs(response.data.jobs);
    renderPagination(response.data.pagination);

    // Update job count
    const jobsCount = document.getElementById('jobsCount');
    if (jobsCount) {
      jobsCount.textContent = response.data.pagination.total;
    }
  } catch (error) {
    console.error('Failed to load jobs:', error);
    showNotification('Failed to load jobs. Please try again.', 'error');
  }
}

async function loadCategories() {
  try {
    const response = await api('/categories');
    const container = document.getElementById('categoryFilters');
    if (!container) return;

    const selected = state.filters.category;
    container.innerHTML = response.data.map(cat => {
      const checked =
        selected && (selected === cat.id || selected === cat.slug) ? 'checked' : '';
      return `
      <label class="filter-checkbox">
        <input type="checkbox" name="category" value="${cat.slug}" ${checked}>
        <span class="checkmark"></span>
        ${cat.name} (${cat.job_count})
      </label>
    `;
    }).join('');
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

// ============================================
// JOB DETAIL MODAL
// ============================================

async function openJobModal(jobId) {
  const modal = document.getElementById('jobModal');
  const jobDetail = document.getElementById('jobDetail');
  
  modal.classList.add('show');
  jobDetail.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    // Track view
    api(`/jobs/${jobId}/view`, { method: 'POST' }).catch(() => {});

    const response = await api(`/jobs/${jobId}`);
    const job = response.data.job;

    jobDetail.innerHTML = `
      <div class="job-detail-header">
        <div class="job-detail-logo">
          ${job.company_logo_url 
            ? `<img src="${job.company_logo_url}" alt="${job.company_name}">`
            : `<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 2rem; font-weight: 600; color: var(--gray-500);">${job.company_name.charAt(0)}</div>`
          }
        </div>
        <div class="job-detail-info">
          <h1>${job.title}</h1>
          <p class="job-detail-company">${job.company_name}</p>
          <div class="job-detail-meta">
            <span class="job-meta-item"><i class="fas fa-map-marker-alt"></i> ${job.location}</span>
            <span class="job-meta-item"><i class="fas fa-briefcase"></i> ${getJobTypeLabel(job.job_type)}</span>
            ${job.category_name ? `<span class="job-meta-item"><i class="fas fa-folder"></i> ${job.category_name}</span>` : ''}
          </div>
        </div>
      </div>

      ${job.salary_min || job.salary_max ? `
        <div class="job-detail-section">
          <h2><i class="fas fa-money-bill-wave"></i> Salary</h2>
          <p class="job-detail-content" style="font-size: 1.25rem; font-weight: 600; color: var(--primary);">
            ${formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_period)}
          </p>
        </div>
      ` : ''}

      <div class="job-detail-section">
        <h2><i class="fas fa-file-alt"></i> Description</h2>
        <div class="job-detail-content">${job.description}</div>
      </div>

      ${job.requirements ? `
        <div class="job-detail-section">
          <h2><i class="fas fa-list-check"></i> Requirements</h2>
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
        <button class="btn btn-outline" onclick="saveJob('${job.id}')">
          <i class="fas fa-bookmark"></i> Save Job
        </button>
        <a href="${job.external_link}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-apply" onclick="trackClick('${job.id}')">
          <i class="fas fa-external-link-alt"></i> Apply on ${job.company_name}
        </a>
      </div>

      ${response.data.relatedJobs?.length > 0 ? `
        <div class="job-detail-section" style="margin-top: var(--space-8);">
          <h2><i class="fas fa-th-large"></i> Related Jobs</h2>
          <div class="jobs-grid" style="margin-top: var(--space-4);">
            ${response.data.relatedJobs.map(job => createJobCard(job)).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (error) {
    jobDetail.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <h3>Failed to load job</h3>
        <p>Please try again later.</p>
      </div>
    `;
  }
}

function closeJobModal() {
  const modal = document.getElementById('jobModal');
  modal.classList.remove('show');
}

async function saveJob(jobId) {
  if (!state.token) {
    showNotification('Please sign in to save jobs', 'warning');
    return;
  }

  try {
    await api(`/users/saved-jobs/${jobId}`, { method: 'POST' });
    showNotification('Job saved successfully!', 'success');
  } catch (error) {
    showNotification(error.message || 'Failed to save job', 'error');
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
}

function handleQuickFilter(filter) {
  const buttons = document.querySelectorAll('.quick-filter');
  buttons.forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  if (filter === 'all') {
    state.filters.job_type = [];
  } else {
    state.filters.job_type = [filter];
  }
  state.currentPage = 1;

  loadJobs();
}

function applyFilters() {
  // Get category filters
  const categoryCheckboxes = document.querySelectorAll('input[name="category"]:checked');
  state.filters.category = categoryCheckboxes.length > 0 ? categoryCheckboxes[0].value : '';

  // Get job type filters
  const jobTypeCheckboxes = document.querySelectorAll('input[name="job_type"]:checked');
  state.filters.job_type = Array.from(jobTypeCheckboxes).map(cb => cb.value);

  // Get date filter
  const dateRadio = document.querySelector('input[name="posted_after"]:checked');
  state.filters.posted_after = dateRadio?.value || '';

  // Get salary filters
  state.filters.salary_min = document.getElementById('salaryMin')?.value || '';
  state.filters.salary_max = document.getElementById('salaryMax')?.value || '';

  state.currentPage = 1;
  loadJobs();
  updateURL();
}

function clearFilters() {
  // Reset state
  state.filters = {
    search: '',
    location: '',
    category: '',
    job_type: [],
    posted_after: '',
    salary_min: '',
    salary_max: '',
  };
  state.currentPage = 1;

  // Reset form inputs
  document.querySelectorAll('.filters-sidebar input[type="checkbox"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.filters-sidebar input[type="radio"]').forEach(rb => rb.checked = false);
  document.getElementById('salaryMin').value = '';
  document.getElementById('salaryMax').value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('locationInput').value = '';

  // Reset quick filters
  document.querySelectorAll('.quick-filter').forEach(btn => btn.classList.remove('active'));
  document.querySelector('.quick-filter[data-filter="all"]')?.classList.add('active');

  loadJobs();
  updateURL();
}

function changePage(page) {
  state.currentPage = page;
  loadJobs();
  updateURL();

  // Scroll to top of jobs list
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
  state.currentPage = parseInt(params.get('page')) || 1;

  // Update input fields
  if (document.getElementById('searchInput')) {
    document.getElementById('searchInput').value = state.filters.search;
  }
  if (document.getElementById('locationInput')) {
    document.getElementById('locationInput').value = state.filters.location;
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // Search
  document.getElementById('searchBtn')?.addEventListener('click', handleSearch);
  document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });
  document.getElementById('locationInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  // Quick filters
  document.querySelectorAll('.quick-filter').forEach(btn => {
    btn.addEventListener('click', () => handleQuickFilter(btn.dataset.filter));
  });

  // Apply filters
  document.getElementById('applyFilters')?.addEventListener('click', applyFilters);
  document.getElementById('clearFilters')?.addEventListener('click', clearFilters);

  // Sort
  document.getElementById('sortSelect')?.addEventListener('change', (e) => {
    handleSort(e.target.value);
  });

  // Modal
  document.getElementById('modalOverlay')?.addEventListener('click', closeJobModal);
  document.getElementById('modalClose')?.addEventListener('click', closeJobModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeJobModal();
  });

  // User menu
  document.getElementById('userMenuBtn')?.addEventListener('click', () => {
    document.getElementById('userDropdown')?.classList.toggle('show');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  // Mobile menu
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('mobileMenu')?.classList.toggle('show');
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) {
      document.getElementById('userDropdown')?.classList.remove('show');
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', () => {
    loadFromURL();
    loadJobs();
  });
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  console.log('🚀 JobsHub initialized');

  // Initialize event listeners
  initEventListeners();

  // Load URL parameters
  loadFromURL();

  // Check authentication
  await checkAuth();

  // Load data
  await Promise.all([
    loadFeaturedJobs(),
    loadJobs(),
    loadCategories(),
  ]);
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
