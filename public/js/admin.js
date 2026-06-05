/**
 * JobsHub Admin Panel JavaScript
 */

const API_BASE = '/api';

// State
const state = {
  token: localStorage.getItem('adminToken'),
  user: null,
  currentPage: 'dashboard',
  jobsPage: 1,
  categories: [],
  selectedJobs: new Set(),
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

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      logout();
    }
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

// ============================================
// AUTHENTICATION
// ============================================

async function checkAuth() {
  if (!state.token) {
    showLoginModal();
    return false;
  }

  try {
    const response = await api('/admin/me');
    state.user = response.data;
    document.getElementById('adminName').textContent = state.user.name || state.user.email;
    hideLoginModal();
    return true;
  } catch (error) {
    showLoginModal();
    return false;
  }
}

async function login(email, password) {
  try {
    const response = await api('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    state.token = response.data.token;
    state.user = response.data.user;
    localStorage.setItem('adminToken', state.token);

    document.getElementById('adminName').textContent = state.user.name || state.user.email;
    hideLoginModal();
    loadDashboard();

    return true;
  } catch (error) {
    throw error;
  }
}

function logout() {
  localStorage.removeItem('adminToken');
  state.token = null;
  state.user = null;
  showLoginModal();
}

function showLoginModal() {
  document.getElementById('loginModal').classList.add('show');
}

function hideLoginModal() {
  document.getElementById('loginModal').classList.remove('show');
}

// ============================================
// NAVIGATION
// ============================================

function navigate(page) {
  state.currentPage = page;

  // Update sidebar
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Update page title
  const titles = {
    dashboard: 'Dashboard',
    jobs: 'Jobs Management',
    categories: 'Categories',
    users: 'Users',
  };
  document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

  // Show/hide views
  document.getElementById('dashboardView').classList.toggle('hidden', page !== 'dashboard');
  document.getElementById('jobsView').classList.toggle('hidden', page !== 'jobs');
  document.getElementById('categoriesView').classList.toggle('hidden', page !== 'categories');
  document.getElementById('usersView').classList.toggle('hidden', page !== 'users');

  // Load data
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'jobs':
      loadJobs();
      break;
    case 'categories':
      loadCategories();
      break;
    case 'users':
      loadUsers();
      break;
  }

  // Update URL
  history.pushState(null, '', `/admin${page !== 'dashboard' ? '/' + page : ''}`);
}

// ============================================
// DASHBOARD
// ============================================

async function loadDashboard() {
  try {
    const response = await api('/admin/stats');
    const { overview, recentJobs, topViewedJobs, categoryStats } = response.data;

    // Update stats
    document.getElementById('totalJobs').textContent = overview.totalJobs.toLocaleString();
    document.getElementById('activeJobs').textContent = overview.activeJobs.toLocaleString();
    document.getElementById('featuredJobs').textContent = overview.featuredJobs.toLocaleString();
    document.getElementById('totalUsers').textContent = overview.totalUsers.toLocaleString();
    document.getElementById('totalViews').textContent = overview.totalViews.toLocaleString();
    document.getElementById('totalClicks').textContent = overview.totalClicks.toLocaleString();

    // Recent jobs table
    document.getElementById('recentJobsTable').innerHTML = recentJobs.length
      ? recentJobs.map(job => `
          <tr>
            <td>${escapeHtml(job.title)}</td>
            <td>${escapeHtml(job.company_name)}</td>
            <td><span class="status-badge status-${job.status}">${job.status}</span></td>
            <td>${formatDate(job.created_at)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="loading-cell">No jobs yet</td></tr>';

    // Top viewed table
    document.getElementById('topViewedTable').innerHTML = topViewedJobs.length
      ? topViewedJobs.map(job => `
          <tr>
            <td>${escapeHtml(job.title)}</td>
            <td>${escapeHtml(job.company_name)}</td>
            <td>${job.view_count.toLocaleString()}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" class="loading-cell">No data</td></tr>';

    // Category stats
    document.getElementById('categoryStats').innerHTML = categoryStats.length
      ? categoryStats.map(cat => `
          <div class="category-item">
            <span class="category-name">
              <i class="fas fa-folder"></i>
              ${escapeHtml(cat.name)}
            </span>
            <span class="category-count">${cat.job_count} jobs</span>
          </div>
        `).join('')
      : '<div class="loading-cell">No categories</div>';

  } catch (error) {
    console.error('Failed to load dashboard:', error);
    showNotification('Failed to load dashboard data', 'error');
  }
}

// ============================================
// JOBS
// ============================================

async function loadJobs() {
  try {
    const search = document.getElementById('jobSearch')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';

    const params = new URLSearchParams({
      page: state.jobsPage,
      limit: 20,
      ...(search && { search }),
      ...(status && { status }),
    });

    const response = await api(`/admin/jobs?${params}`);
    const { jobs, pagination } = response.data;

    // Load categories for form
    await loadCategoriesForForm();

    // Render table
    const tbody = document.getElementById('jobsTableBody');
    tbody.innerHTML = jobs.length
      ? jobs.map(job => `
          <tr data-id="${job.id}">
            <td>
              <input type="checkbox" class="job-checkbox" value="${job.id}" 
                ${state.selectedJobs.has(job.id) ? 'checked' : ''}>
            </td>
            <td>
              <div class="job-table-info">
                <div class="job-table-logo">
                  ${job.company_logo_url 
                    ? `<img src="${job.company_logo_url}" alt="${escapeHtml(job.company_name)}">`
                    : `<span style="font-weight: 600; color: var(--gray-500);">${job.company_name.charAt(0)}</span>`
                  }
                </div>
                <div class="job-table-text">
                  <h4>${escapeHtml(job.title)}</h4>
                  <p>${escapeHtml(job.company_name)}</p>
                </div>
              </div>
            </td>
            <td>${job.category_name || '-'}</td>
            <td>${escapeHtml(job.location)}</td>
            <td><span class="job-tag ${job.job_type}">${getJobTypeLabel(job.job_type)}</span></td>
            <td>
              <span class="status-badge status-${job.status}">${job.status}</span>
              ${job.is_featured ? '<span class="status-badge" style="background: #FEF3C7; color: #92400E;">⭐</span>' : ''}
            </td>
            <td>${job.view_count.toLocaleString()}</td>
            <td>
              <div class="action-btns">
                <button class="action-btn" onclick="editJob('${job.id}')" title="Edit">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn delete" onclick="deleteJob('${job.id}')" title="Delete">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="8" class="loading-cell">No jobs found</td></tr>';

    // Render pagination
    renderPagination('jobsPagination', pagination, (page) => {
      state.jobsPage = page;
      loadJobs();
    });

    // Update bulk actions visibility
    updateBulkActions();

  } catch (error) {
    console.error('Failed to load jobs:', error);
    showNotification('Failed to load jobs', 'error');
  }
}

async function loadCategoriesForForm() {
  if (state.categories.length > 0) return;

  try {
    const response = await api('/admin/categories');
    state.categories = response.data;

    const select = document.getElementById('jobCategory');
    select.innerHTML = '<option value="">Select Category</option>' +
      state.categories.map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join('');
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

function openJobModal(job = null) {
  const modal = document.getElementById('jobModal');
  const form = document.getElementById('jobForm');
  const title = document.getElementById('jobModalTitle');

  form.reset();

  if (job) {
    title.textContent = 'Edit Job';
    document.getElementById('jobId').value = job.id;
    document.getElementById('jobTitle').value = job.title;
    document.getElementById('companyName').value = job.company_name;
    document.getElementById('companyLogo').value = job.company_logo_url || '';
    document.getElementById('companyWebsite').value = job.company_website || '';
    document.getElementById('jobDescription').value = job.description;
    document.getElementById('jobRequirements').value = job.requirements || '';
    document.getElementById('jobBenefits').value = job.benefits || '';
    document.getElementById('jobLocation').value = job.location;
    document.getElementById('jobType').value = job.job_type;
    document.getElementById('jobCategory').value = job.category_id || '';
    document.getElementById('salaryMin').value = job.salary_min || '';
    document.getElementById('salaryMax').value = job.salary_max || '';
    document.getElementById('salaryCurrency').value = job.salary_currency || 'KES';
    document.getElementById('salaryPeriod').value = job.salary_period || 'monthly';
    document.getElementById('externalLink').value = job.external_link;
    document.getElementById('expiryDate').value = job.expiry_date ? job.expiry_date.split('T')[0] : '';
    document.getElementById('jobStatus').value = job.status;
    document.getElementById('isFeatured').checked = job.is_featured;
  } else {
    title.textContent = 'Add New Job';
    document.getElementById('jobId').value = '';
    // Set default expiry date to 30 days from now
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    document.getElementById('expiryDate').value = defaultExpiry.toISOString().split('T')[0];
  }

  modal.classList.add('show');
}

function closeJobModal() {
  document.getElementById('jobModal').classList.remove('show');
}

async function saveJob(e) {
  e.preventDefault();

  const jobId = document.getElementById('jobId').value;
  const isEdit = !!jobId;

  const jobData = {
    title: document.getElementById('jobTitle').value,
    company_name: document.getElementById('companyName').value,
    company_logo_url: document.getElementById('companyLogo').value || null,
    company_website: document.getElementById('companyWebsite').value || null,
    description: document.getElementById('jobDescription').value,
    requirements: document.getElementById('jobRequirements').value || null,
    benefits: document.getElementById('jobBenefits').value || null,
    location: document.getElementById('jobLocation').value,
    job_type: document.getElementById('jobType').value,
    category_id: document.getElementById('jobCategory').value || null,
    salary_min: parseInt(document.getElementById('salaryMin').value) || null,
    salary_max: parseInt(document.getElementById('salaryMax').value) || null,
    salary_currency: document.getElementById('salaryCurrency').value,
    salary_period: document.getElementById('salaryPeriod').value,
    external_link: document.getElementById('externalLink').value,
    expiry_date: document.getElementById('expiryDate').value || null,
    status: document.getElementById('jobStatus').value,
    is_featured: document.getElementById('isFeatured').checked,
  };

  try {
    if (isEdit) {
      await api(`/admin/jobs/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify(jobData),
      });
      showNotification('Job updated successfully', 'success');
    } else {
      await api('/admin/jobs', {
        method: 'POST',
        body: JSON.stringify(jobData),
      });
      showNotification('Job created successfully', 'success');
    }

    closeJobModal();
    loadJobs();
  } catch (error) {
    showNotification(error.message || 'Failed to save job', 'error');
  }
}

async function editJob(id) {
  try {
    const response = await api(`/admin/jobs/${id}`);
    openJobModal(response.data);
  } catch (error) {
    showNotification('Failed to load job details', 'error');
  }
}

async function deleteJob(id) {
  if (!confirm('Are you sure you want to delete this job?')) return;

  try {
    await api(`/admin/jobs/${id}`, { method: 'DELETE' });
    showNotification('Job deleted successfully', 'success');
    loadJobs();
  } catch (error) {
    showNotification(error.message || 'Failed to delete job', 'error');
  }
}

async function bulkAction(action) {
  if (state.selectedJobs.size === 0) return;

  const jobIds = Array.from(state.selectedJobs);
  const actionText = action === 'delete' ? 'delete' : action;

  if (action === 'delete' && !confirm(`Are you sure you want to delete ${jobIds.length} jobs?`)) {
    return;
  }

  try {
    await api('/admin/jobs/bulk', {
      method: 'POST',
      body: JSON.stringify({ action, jobIds }),
    });

    showNotification(`Successfully ${actionText}d ${jobIds.length} jobs`, 'success');
    state.selectedJobs.clear();
    loadJobs();
  } catch (error) {
    showNotification(error.message || `Failed to ${actionText} jobs`, 'error');
  }
}

function updateBulkActions() {
  const bulkActions = document.getElementById('bulkActions');
  const selectedCount = document.getElementById('selectedCount');

  if (state.selectedJobs.size > 0) {
    bulkActions.classList.remove('hidden');
    selectedCount.textContent = `${state.selectedJobs.size} selected`;
  } else {
    bulkActions.classList.add('hidden');
  }
}

// ============================================
// CATEGORIES
// ============================================

async function loadCategories() {
  try {
    const response = await api('/admin/categories');
    state.categories = response.data;

    const grid = document.getElementById('categoriesGrid');
    grid.innerHTML = state.categories.length
      ? state.categories.map(cat => `
          <div class="category-card">
            <div class="category-card-header">
              <div class="category-icon">
                <i class="fas fa-${cat.icon || 'folder'}"></i>
              </div>
              <div class="category-card-info">
                <h4>${escapeHtml(cat.name)}</h4>
                <p>${cat.job_count || 0} jobs</p>
              </div>
            </div>
            ${cat.description ? `<p style="color: var(--gray-500); font-size: var(--font-size-sm);">${escapeHtml(cat.description)}</p>` : ''}
            <div class="category-card-actions">
              <button class="btn btn-ghost btn-sm" onclick="editCategory('${cat.id}')">
                <i class="fas fa-edit"></i> Edit
              </button>
              <button class="btn btn-ghost btn-sm" onclick="deleteCategory('${cat.id}')" style="color: var(--error);">
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          </div>
        `).join('')
      : '<div class="loading-cell" style="grid-column: 1/-1;">No categories found. Add your first category!</div>';

  } catch (error) {
    console.error('Failed to load categories:', error);
    showNotification('Failed to load categories', 'error');
  }
}

function openCategoryModal(category = null) {
  const modal = document.getElementById('categoryModal');
  const form = document.getElementById('categoryForm');
  const title = document.getElementById('categoryModalTitle');

  form.reset();

  if (category) {
    title.textContent = 'Edit Category';
    document.getElementById('categoryId').value = category.id;
    document.getElementById('categoryName').value = category.name;
    document.getElementById('categoryIcon').value = category.icon || '';
    document.getElementById('categoryDescription').value = category.description || '';
  } else {
    title.textContent = 'Add Category';
    document.getElementById('categoryId').value = '';
  }

  modal.classList.add('show');
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('show');
}

async function saveCategory(e) {
  e.preventDefault();

  const categoryId = document.getElementById('categoryId').value;
  const isEdit = !!categoryId;

  const categoryData = {
    name: document.getElementById('categoryName').value,
    icon: document.getElementById('categoryIcon').value || null,
    description: document.getElementById('categoryDescription').value || null,
  };

  try {
    if (isEdit) {
      await api(`/admin/categories/${categoryId}`, {
        method: 'PUT',
        body: JSON.stringify(categoryData),
      });
      showNotification('Category updated successfully', 'success');
    } else {
      await api('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(categoryData),
      });
      showNotification('Category created successfully', 'success');
    }

    closeCategoryModal();
    state.categories = []; // Reset to force reload
    loadCategories();
  } catch (error) {
    showNotification(error.message || 'Failed to save category', 'error');
  }
}

async function editCategory(id) {
  const category = state.categories.find(c => c.id === id);
  if (category) {
    openCategoryModal(category);
  }
}

async function deleteCategory(id) {
  if (!confirm('Are you sure you want to delete this category?')) return;

  try {
    await api(`/admin/categories/${id}`, { method: 'DELETE' });
    showNotification('Category deleted successfully', 'success');
    state.categories = [];
    loadCategories();
  } catch (error) {
    showNotification(error.message || 'Failed to delete category', 'error');
  }
}

// ============================================
// USERS
// ============================================

async function loadUsers() {
  try {
    const response = await api('/admin/users');
    const { users } = response.data;

    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = users.length
      ? users.map(user => `
          <tr>
            <td>${escapeHtml(user.name || 'No name')}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>${user.saved_jobs_count}</td>
            <td>${user.alerts_count}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>${user.last_login ? formatDate(user.last_login) : 'Never'}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6" class="loading-cell">No users found</td></tr>';

  } catch (error) {
    console.error('Failed to load users:', error);
    showNotification('Failed to load users', 'error');
  }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getJobTypeLabel(type) {
  const labels = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
  return labels[type] || type;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `alert alert-${type}`;
  notification.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i> ${message}`;
  notification.style.cssText = 'position: fixed; top: 80px; right: 20px; z-index: 1000; min-width: 300px;';

  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

function renderPagination(containerId, pagination, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container || pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const { page, totalPages } = pagination;
  let html = '';

  html += `<button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="arguments[0].stopPropagation()">
    <i class="fas fa-chevron-left"></i>
  </button>`;

  for (let i = 1; i <= Math.min(totalPages, 5); i++) {
    html += `<button class="pagination-btn ${i === page ? 'active' : ''}">${i}</button>`;
  }

  html += `<button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''}>
    <i class="fas fa-chevron-right"></i>
  </button>`;

  container.innerHTML = html;

  container.querySelectorAll('.pagination-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => {
      if (index === 0 && page > 1) onPageChange(page - 1);
      else if (index === container.querySelectorAll('.pagination-btn').length - 1 && page < totalPages) onPageChange(page + 1);
      else if (index > 0 && index < container.querySelectorAll('.pagination-btn').length - 1) onPageChange(index);
    });
  });
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // Login form
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    try {
      await login(email, password);
    } catch (error) {
      errorDiv.textContent = error.message || 'Login failed';
      errorDiv.classList.remove('hidden');
    }
  });

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  // Sidebar navigation
  document.querySelectorAll('.sidebar-link[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  // Mobile sidebar toggle
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('show');
  });

  // Add job button
  document.getElementById('addJobBtn')?.addEventListener('click', () => openJobModal());
  document.getElementById('jobForm')?.addEventListener('submit', saveJob);

  // Add category button
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);

  // Job search and filter
  document.getElementById('jobSearch')?.addEventListener('input', debounce(() => {
    state.jobsPage = 1;
    loadJobs();
  }, 300));

  document.getElementById('statusFilter')?.addEventListener('change', () => {
    state.jobsPage = 1;
    loadJobs();
  });

  // Select all checkbox
  document.getElementById('selectAll')?.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.job-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) {
        state.selectedJobs.add(cb.value);
      } else {
        state.selectedJobs.delete(cb.value);
      }
    });
    updateBulkActions();
  });

  // Individual job checkboxes (delegated)
  document.getElementById('jobsTableBody')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('job-checkbox')) {
      if (e.target.checked) {
        state.selectedJobs.add(e.target.value);
      } else {
        state.selectedJobs.delete(e.target.value);
      }
      updateBulkActions();
    }
  });

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    const path = window.location.pathname.replace('/admin', '').replace('/', '');
    navigate(path || 'dashboard');
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  console.log('🔧 Admin panel initialized');

  initEventListeners();

  const isAuth = await checkAuth();
  if (isAuth) {
    // Determine initial page from URL
    const path = window.location.pathname.replace('/admin', '').replace('/', '');
    navigate(path || 'dashboard');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
