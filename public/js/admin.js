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
  usersPage: 1,
  categories: [],
  selectedJobs: new Set(),
  currentUserAlerts: [],
};

const KENYA_COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa',
  'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi',
  'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos',
  'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a",
  'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri',
  'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia',
  'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

const SOURCE_TYPE_LABELS = {
  DIRECT: 'Direct',
  BOARD: 'Board',
  API: 'API',
  COMPANY_CAREER: 'Career page',
  GOVERNMENT: 'Government',
  NGO: 'NGO',
  RECRUITMENT_AGENCY: 'Agency',
  PARTNER: 'Partner',
  USER_SUBMITTED: 'User',
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
    'admin-access': 'Admin Access',
  };
  document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

  // Show/hide views
  document.getElementById('dashboardView').classList.toggle('hidden', page !== 'dashboard');
  document.getElementById('jobsView').classList.toggle('hidden', page !== 'jobs');
  document.getElementById('categoriesView').classList.toggle('hidden', page !== 'categories');
  document.getElementById('usersView').classList.toggle('hidden', page !== 'users');
  document.getElementById('adminAccessView').classList.toggle('hidden', page !== 'admin-access');

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
    case 'admin-access':
      loadAdmins();
      break;
  }

  // Update URL
  history.pushState(null, '', `/admin${page !== 'dashboard' ? '/' + page : ''}`);
}

async function loadAdmins() {
  const tbody = document.getElementById('adminsTableBody');
  try {
    const response = await api('/admin/users?role=admin&limit=100');
    const admins = response.data.users || [];
    tbody.innerHTML = admins.length ? admins.map((admin) => `
      <tr><td>${escapeHtml(admin.name || '—')}</td><td>${escapeHtml(admin.email)}</td>
      <td>${admin.last_login ? formatDate(admin.last_login) : 'Never'}</td><td>${formatDate(admin.created_at)}</td></tr>
    `).join('') : '<tr><td colspan="4">No administrators found.</td></tr>';
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="4">Could not load administrators.</td></tr>';
    showNotification(error.message || 'Could not load administrators', 'error');
  }
}

async function changeAdminPassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentAdminPassword').value;
  const newPassword = document.getElementById('newAdminPassword').value;
  const confirmation = document.getElementById('confirmAdminPassword').value;
  if (newPassword !== confirmation) {
    showNotification('New passwords do not match', 'error');
    return;
  }
  try {
    await api('/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    document.getElementById('adminPasswordForm').reset();
    showNotification('Password updated successfully', 'success');
  } catch (error) {
    showNotification(error.message || 'Failed to update password', 'error');
  }
}

async function createAdmin(e) {
  e.preventDefault();
  try {
    await api('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('newAdminName').value,
        email: document.getElementById('newAdminEmail').value,
        password: document.getElementById('newAdminTempPassword').value,
        role: 'admin',
      }),
    });
    document.getElementById('createAdminForm').reset();
    showNotification('Administrator created successfully', 'success');
    loadAdmins();
  } catch (error) {
    showNotification(error.message || 'Failed to create administrator', 'error');
  }
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

    const category = document.getElementById('jobCategoryFilter')?.value || '';
    const sourceType = document.getElementById('sourceTypeFilter')?.value || '';
    const verification = document.getElementById('verificationFilter')?.value || '';
    const county = document.getElementById('countyFilter')?.value || '';

    const params = new URLSearchParams({
      page: state.jobsPage,
      limit: 20,
      ...(search && { search }),
      ...(status && { status }),
      ...(category && { category }),
      ...(sourceType && { source_type: sourceType }),
      ...(verification && { verification_status: verification }),
      ...(county && { county }),
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
            <td>
              ${escapeHtml(job.location || '-')}
              ${job.county ? `<div class="muted-line">${escapeHtml(job.county)}</div>` : ''}
            </td>
            <td><span class="job-tag ${job.job_type}">${getJobTypeLabel(job.job_type)}</span></td>
            <td>
              <span class="status-badge status-source">${escapeHtml(SOURCE_TYPE_LABELS[job.source_type] || job.source_type || job.source || '-')}</span>
              ${job.verification_status ? `<span class="status-badge status-verify-${job.verification_status}">${escapeHtml(job.verification_status)}</span>` : ''}
            </td>
            <td>
              <span class="status-badge status-${job.status}">${job.status}</span>
              ${job.is_featured ? '<span class="status-badge" style="background: #FEF3C7; color: #92400E;">⭐</span>' : ''}
            </td>
            <td>${(job.view_count || 0).toLocaleString()}</td>
            <td>
              <div class="action-btns">
                <button class="action-btn" onclick="exportJobImage('${job.id}')" title="Export mobile job image" aria-label="Export mobile job image">
                  <i class="fas fa-image"></i>
                </button>
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
      : '<tr><td colspan="9" class="loading-cell">No jobs found</td></tr>';

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

async function exportJobImage(jobId) {
  const modal = document.getElementById('posterExportModal');
  const capture = document.getElementById('posterCapture');
  const download = document.getElementById('downloadPosterBtn');
  capture.innerHTML = '<div class="loading-cell">Loading job preview…</div>';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  download.disabled = true;
  download.dataset.jobTitle = '';

  try {
    const response = await api(`/admin/jobs/${encodeURIComponent(jobId)}`);
    const job = response.data;
    const location = job.location || 'Flexible';
    capture.innerHTML = `
      <div class="poster-export-content">
        <div class="job-detail-header">
          <div class="job-detail-info">
            <h1>${escapeHtml(job.title)}</h1>
            <p class="job-detail-company">${escapeHtml(job.company_name)}</p>
            <div class="job-detail-meta">
              <span class="job-meta-item"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(location)}</span>
              <span class="job-meta-item"><i class="fas fa-briefcase"></i> ${escapeHtml(getJobTypeLabel(job.job_type))}</span>
              ${job.category_name ? `<span class="job-meta-item"><i class="fas fa-layer-group"></i> ${escapeHtml(job.category_name)}</span>` : ''}
              <span class="job-meta-item"><i class="fas fa-clock"></i> ${escapeHtml(formatDate(job.posted_date))}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    download.dataset.jobTitle = job.title || 'job-opportunity';
    download.disabled = false;
  } catch (error) {
    capture.innerHTML = `<p class="alert alert-error">${escapeHtml(error.message || 'Could not load this job')}</p>`;
  }
}

function closePosterExport() {
  const modal = document.getElementById('posterExportModal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

async function downloadPosterImage() {
  const capture = document.getElementById('posterCapture');
  const button = document.getElementById('downloadPosterBtn');
  if (!window.html2canvas) {
    showNotification('Image export library did not load. Refresh the page and try again.', 'error');
    return;
  }
  button.disabled = true;
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(capture, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const link = document.createElement('a');
    const safeName = String(button.dataset.jobTitle || 'job-opportunity')
      .normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    link.download = `${safeName || 'job-opportunity'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    showNotification(error.message || 'Could not create the PNG image', 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadCategoriesForForm() {
  if (state.categories.length === 0) {
    try {
      const response = await api('/admin/categories');
      state.categories = response.data || [];
    } catch (error) {
      console.error('Failed to load categories:', error);
      return;
    }
  }

  const options = state.categories.map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join('');
  const jobCategory = document.getElementById('jobCategory');
  if (jobCategory) {
    const current = jobCategory.value;
    jobCategory.innerHTML = '<option value="">Select Category</option>' + options;
    if (current) jobCategory.value = current;
  }

  const jobCategoryFilter = document.getElementById('jobCategoryFilter');
  if (jobCategoryFilter && jobCategoryFilter.options.length <= 1) {
    jobCategoryFilter.innerHTML = '<option value="">All Categories</option>' + options;
  }

  const userCats = document.getElementById('userPreferredCategories');
  if (userCats && userCats.options.length === 0) {
    userCats.innerHTML = options;
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
    document.getElementById('applicationUrl').value = job.application_url || '';
    document.getElementById('sourceUrl').value = job.source_url || '';
    document.getElementById('expiryDate').value = dateInputValue(job.expiry_date);
    document.getElementById('postedDate').value = dateInputValue(job.posted_date);
    document.getElementById('jobDeadline').value = dateInputValue(job.deadline);
    document.getElementById('featuredUntil').value = dateInputValue(job.featured_until);
    document.getElementById('jobStatus').value = job.status;
    document.getElementById('isFeatured').checked = job.is_featured;
    const countySelect = document.getElementById('jobCounty');
    if (job.county && ![...countySelect.options].some((o) => o.value === job.county)) {
      countySelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(job.county)}">${escapeHtml(job.county)}</option>`);
    }
    countySelect.value = job.county || '';
    document.getElementById('jobCountryCode').value = job.country_code || 'KE';
    document.getElementById('jobSource').value = job.source || '';
    document.getElementById('jobSourceType').value = job.source_type || 'DIRECT';
    document.getElementById('jobVerification').value = job.verification_status || 'verified';
    document.getElementById('jobSourceId').value = job.job_source_id || '';
    document.getElementById('isAggregated').checked = job.is_aggregated;
    document.getElementById('metaTitle').value = job.meta_title || '';
    document.getElementById('metaDescription').value = job.meta_description || '';
    const meta = document.getElementById('jobReadonlyMeta');
    meta.classList.remove('hidden');
    meta.textContent = `ID ${job.id} · slug ${job.slug || '—'} · ${job.view_count || 0} views · ${job.click_count || 0} clicks`;
  } else {
    title.textContent = 'Add New Job';
    document.getElementById('jobId').value = '';
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    document.getElementById('expiryDate').value = defaultExpiry.toISOString().split('T')[0];
    document.getElementById('postedDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('jobCountryCode').value = 'KE';
    document.getElementById('jobSource').value = 'manual';
    document.getElementById('jobSourceType').value = 'DIRECT';
    document.getElementById('jobVerification').value = 'verified';
    document.getElementById('isAggregated').checked = false;
    document.getElementById('jobReadonlyMeta').classList.add('hidden');
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
    application_url: document.getElementById('applicationUrl').value || null,
    source_url: document.getElementById('sourceUrl').value || null,
    expiry_date: document.getElementById('expiryDate').value || null,
    posted_date: document.getElementById('postedDate').value || null,
    deadline: document.getElementById('jobDeadline').value || null,
    featured_until: document.getElementById('featuredUntil').value || null,
    status: document.getElementById('jobStatus').value,
    is_featured: document.getElementById('isFeatured').checked,
    county: document.getElementById('jobCounty').value || null,
    country_code: (document.getElementById('jobCountryCode').value || 'KE').toUpperCase(),
    source: document.getElementById('jobSource').value || 'manual',
    source_type: document.getElementById('jobSourceType').value || 'DIRECT',
    verification_status: document.getElementById('jobVerification').value || 'verified',
    job_source_id: document.getElementById('jobSourceId').value || null,
    is_aggregated: document.getElementById('isAggregated').checked,
    meta_title: document.getElementById('metaTitle').value || null,
    meta_description: document.getElementById('metaDescription').value || null,
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
    await loadCategoriesForForm();

    const q = document.getElementById('userSearch')?.value || '';
    const role = document.getElementById('userRoleFilter')?.value || '';
    const profileStatus = document.getElementById('userProfileFilter')?.value || '';
    const telegram = document.getElementById('userTelegramFilter')?.value || '';
    const hasCv = document.getElementById('userCvFilter')?.value || '';

    const params = new URLSearchParams({
      page: state.usersPage,
      limit: 20,
      ...(q && { q }),
      ...(role && { role }),
      ...(profileStatus && { profile_status: profileStatus }),
      ...(telegram && { telegram }),
      ...(hasCv && { has_cv: hasCv }),
    });

    const response = await api(`/admin/users?${params}`);
    const { users, pagination } = response.data;

    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = users.length
      ? users.map(user => `
          <tr data-id="${user.id}">
            <td>
              <div class="job-table-text">
                <h4>${escapeHtml(user.name || 'No name')}</h4>
                <span class="status-badge status-role-${user.role}">${user.role}</span>
              </div>
            </td>
            <td>${escapeHtml(user.email)}</td>
            <td><span class="status-badge status-profile-${user.profile_status || 'none'}">${formatProfileStatus(user.profile_status)}</span></td>
            <td>
              ${user.telegram_linked
                ? `<span class="status-badge status-active">Linked</span>`
                : `<span class="status-badge status-draft">—</span>`}
              ${user.telegram_username ? `<div class="muted-line">@${escapeHtml(user.telegram_username)}</div>` : ''}
            </td>
            <td>${user.has_cv ? escapeHtml(user.cv_original_name || 'Yes') : '—'}</td>
            <td>${user.saved_jobs_count || 0}</td>
            <td>${user.alerts_count || 0}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>
              <div class="action-btns">
                <button class="action-btn" onclick="editUser('${user.id}')" title="Edit">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="action-btn delete" onclick="deleteUser('${user.id}')" title="Delete">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="9" class="loading-cell">No users found</td></tr>';

    renderPagination('usersPagination', pagination, (page) => {
      state.usersPage = page;
      loadUsers();
    });
  } catch (error) {
    console.error('Failed to load users:', error);
    showNotification('Failed to load users', 'error');
  }
}

function openUserModal(user = null) {
  const modal = document.getElementById('userModal');
  const form = document.getElementById('userForm');
  const title = document.getElementById('userModalTitle');
  form.reset();
  state.currentUserAlerts = [];

  document.querySelectorAll('input[name="notifyChannel"]').forEach((el) => {
    el.checked = el.value === 'email';
  });
  document.querySelectorAll('input[name="prefJobType"]').forEach((el) => {
    el.checked = false;
  });
  const catSelect = document.getElementById('userPreferredCategories');
  [...catSelect.options].forEach((opt) => { opt.selected = false; });

  if (user) {
    title.textContent = 'Edit User';
    document.getElementById('userId').value = user.id;
    document.getElementById('userName').value = user.name || '';
    document.getElementById('userEmail').value = user.email || '';
    document.getElementById('userRole').value = user.role || 'user';
    document.getElementById('userPassword').required = false;
    document.getElementById('userPasswordHint').textContent = '(leave blank to keep)';
    document.getElementById('userAvatar').value = user.avatar_url || '';
    document.getElementById('userEmailVerified').checked = !!user.email_verified;
    document.getElementById('userTelegramUsername').value = user.telegram_username || '';
    document.getElementById('userWhatsapp').value = user.whatsapp_number || '';
    document.getElementById('userPreferredLocations').value = asList(user.preferred_locations).join(', ');
    document.getElementById('userSkills').value = asList(user.skills).join(', ');
    document.getElementById('userKeywords').value = asList(user.profile_keywords).join(', ');
    document.getElementById('userProfileSummary').value = user.profile_summary || '';
    document.getElementById('userSeniority').value = user.profile_seniority || '';
    document.getElementById('userProfileStatus').value = user.profile_status || 'none';

    const channels = asList(user.notify_channels);
    document.querySelectorAll('input[name="notifyChannel"]').forEach((el) => {
      el.checked = channels.includes(el.value);
    });
    const types = asList(user.preferred_job_types);
    document.querySelectorAll('input[name="prefJobType"]').forEach((el) => {
      el.checked = types.includes(el.value);
    });
    const prefCats = asList(user.preferred_categories);
    [...catSelect.options].forEach((opt) => {
      opt.selected = prefCats.includes(opt.value);
    });

    const tgRow = document.getElementById('userTelegramRow');
    if (user.telegram_linked || user.telegram_chat_id) {
      tgRow.classList.remove('hidden');
      document.getElementById('userTelegramChat').textContent = `Chat ID: ${user.telegram_chat_id || 'linked'}`;
    } else {
      tgRow.classList.add('hidden');
    }

    document.getElementById('userCvMeta').textContent = user.has_cv
      ? `${user.cv_original_name || 'CV uploaded'} · ${user.cv_uploaded_at ? formatDate(user.cv_uploaded_at) : ''}`
      : 'No CV';

    const meta = document.getElementById('userReadonlyMeta');
    meta.classList.remove('hidden');
    meta.textContent = `Joined ${formatDate(user.created_at)} · last login ${user.last_login ? formatDate(user.last_login) : 'never'} · profiled ${user.profiled_at ? formatDate(user.profiled_at) : '—'}`;

    renderUserAlerts(user.alerts || []);
  } else {
    title.textContent = 'Add User';
    document.getElementById('userId').value = '';
    document.getElementById('userPassword').required = true;
    document.getElementById('userPasswordHint').textContent = '(required)';
    document.getElementById('userTelegramRow').classList.add('hidden');
    document.getElementById('userCvMeta').textContent = 'No CV';
    document.getElementById('userReadonlyMeta').classList.add('hidden');
    document.getElementById('userAlertsSection').classList.add('hidden');
    document.getElementById('userAlertsList').innerHTML = '';
  }

  modal.classList.add('show');
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('show');
}

function renderUserAlerts(alerts) {
  state.currentUserAlerts = alerts || [];
  const section = document.getElementById('userAlertsSection');
  const list = document.getElementById('userAlertsList');
  if (!alerts || alerts.length === 0) {
    section.classList.remove('hidden');
    list.innerHTML = '<p class="muted-line">No alerts</p>';
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = alerts.map((alert) => {
    const criteria = summarizeCriteria(alert.search_criteria);
    return `
      <div class="alert-admin-row" data-alert-id="${alert.id}">
        <div>
          <strong>${escapeHtml(alert.name || 'Untitled alert')}</strong>
          <div class="muted-line">${escapeHtml(criteria)} · ${alert.frequency} · last sent ${alert.last_sent_at ? formatDate(alert.last_sent_at) : 'never'}</div>
        </div>
        <div class="action-btns">
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleUserAlert('${alert.id}', ${alert.is_active ? 'false' : 'true'})">
            ${alert.is_active ? 'Disable' : 'Enable'}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" style="color: var(--error);" onclick="deleteUserAlert('${alert.id}')">
            Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function collectUserFormData() {
  const notify = [...document.querySelectorAll('input[name="notifyChannel"]:checked')].map((el) => el.value);
  const jobTypes = [...document.querySelectorAll('input[name="prefJobType"]:checked')].map((el) => el.value);
  const categories = [...document.getElementById('userPreferredCategories').selectedOptions].map((opt) => opt.value);
  const password = document.getElementById('userPassword').value;

  const data = {
    name: document.getElementById('userName').value || null,
    email: document.getElementById('userEmail').value,
    role: document.getElementById('userRole').value,
    avatar_url: document.getElementById('userAvatar').value || null,
    email_verified: document.getElementById('userEmailVerified').checked,
    notify_channels: notify.length ? notify : ['email'],
    telegram_username: document.getElementById('userTelegramUsername').value || null,
    whatsapp_number: document.getElementById('userWhatsapp').value || null,
    preferred_locations: splitCsv(document.getElementById('userPreferredLocations').value),
    preferred_job_types: jobTypes,
    preferred_categories: categories,
    skills: splitCsv(document.getElementById('userSkills').value),
    profile_keywords: splitCsv(document.getElementById('userKeywords').value),
    profile_summary: document.getElementById('userProfileSummary').value || null,
    profile_seniority: document.getElementById('userSeniority').value || null,
    profile_status: document.getElementById('userProfileStatus').value,
  };
  if (password) data.password = password;
  return data;
}

async function saveUser(e) {
  e.preventDefault();
  const userId = document.getElementById('userId').value;
  const isEdit = !!userId;
  const userData = collectUserFormData();

  if (!isEdit && !userData.password) {
    showNotification('Password is required for new users', 'error');
    return;
  }

  try {
    if (isEdit) {
      await api(`/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(userData),
      });
      showNotification('User updated successfully', 'success');
    } else {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify(userData),
      });
      showNotification('User created successfully', 'success');
    }
    closeUserModal();
    loadUsers();
  } catch (error) {
    showNotification(error.message || 'Failed to save user', 'error');
  }
}

async function editUser(id) {
  try {
    await loadCategoriesForForm();
    const response = await api(`/admin/users/${id}`);
    openUserModal(response.data);
  } catch (error) {
    showNotification('Failed to load user details', 'error');
  }
}

async function deleteUser(id) {
  if (state.user && state.user.id === id) {
    showNotification('You cannot delete your own account', 'error');
    return;
  }
  if (!confirm('Delete this user? Saved jobs and alerts will be removed.')) return;

  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    showNotification('User deleted', 'success');
    loadUsers();
  } catch (error) {
    showNotification(error.message || 'Failed to delete user', 'error');
  }
}

async function unlinkCurrentUserTelegram() {
  const userId = document.getElementById('userId').value;
  if (!userId) return;
  if (!confirm('Unlink Telegram for this user?')) return;
  try {
    await api(`/admin/users/${userId}/unlink-telegram`, { method: 'POST' });
    showNotification('Telegram unlinked', 'success');
    editUser(userId);
  } catch (error) {
    showNotification(error.message || 'Failed to unlink Telegram', 'error');
  }
}

async function toggleUserAlert(alertId, isActive) {
  const userId = document.getElementById('userId').value;
  try {
    await api(`/admin/users/${userId}/alerts/${alertId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: isActive === true || isActive === 'true' }),
    });
    const response = await api(`/admin/users/${userId}`);
    renderUserAlerts(response.data.alerts || []);
    showNotification('Alert updated', 'success');
  } catch (error) {
    showNotification(error.message || 'Failed to update alert', 'error');
  }
}

async function deleteUserAlert(alertId) {
  const userId = document.getElementById('userId').value;
  if (!confirm('Delete this alert?')) return;
  try {
    await api(`/admin/users/${userId}/alerts/${alertId}`, { method: 'DELETE' });
    const response = await api(`/admin/users/${userId}`);
    renderUserAlerts(response.data.alerts || []);
    showNotification('Alert deleted', 'success');
  } catch (error) {
    showNotification(error.message || 'Failed to delete alert', 'error');
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

function dateInputValue(value) {
  if (!value) return '';
  return String(value).split('T')[0];
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return splitCsv(String(value).replace(/^\{|\}$/g, ''));
}

function formatProfileStatus(status) {
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'pending_confirm') return 'Pending';
  return 'None';
}

function summarizeCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object') return 'No criteria';
  return Object.entries(criteria)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`)
    .join(', ') || 'No criteria';
}

function fillCountySelects() {
  const countyOptions = KENYA_COUNTIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  const jobCounty = document.getElementById('jobCounty');
  if (jobCounty && jobCounty.options.length <= 1) {
    jobCounty.innerHTML = '<option value="">Select county</option>' + countyOptions;
  }
  const countyFilter = document.getElementById('countyFilter');
  if (countyFilter && countyFilter.options.length <= 1) {
    countyFilter.innerHTML = '<option value="">All Counties</option>' + countyOptions;
  }
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
  if (!container) return;
  if (!pagination || pagination.totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const page = pagination.page;
  const totalPages = pagination.totalPages;
  const pages = [];
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  container.innerHTML = `
    <button type="button" class="pagination-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
      <i class="fas fa-chevron-left"></i>
    </button>
    ${pages.map((n) => `<button type="button" class="pagination-btn ${n === page ? 'active' : ''}" data-page="${n}">${n}</button>`).join('')}
    <button type="button" class="pagination-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>
      <i class="fas fa-chevron-right"></i>
    </button>
  `;

  container.querySelectorAll('.pagination-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const next = parseInt(btn.dataset.page, 10);
      if (next >= 1 && next <= totalPages && next !== page) onPageChange(next);
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

  // Users
  document.getElementById('addUserBtn')?.addEventListener('click', async () => {
    await loadCategoriesForForm();
    openUserModal();
  });
  document.getElementById('userForm')?.addEventListener('submit', saveUser);
  document.getElementById('adminPasswordForm')?.addEventListener('submit', changeAdminPassword);
  document.getElementById('createAdminForm')?.addEventListener('submit', createAdmin);
  document.getElementById('unlinkTelegramBtn')?.addEventListener('click', unlinkCurrentUserTelegram);

  document.getElementById('userSearch')?.addEventListener('input', debounce(() => {
    state.usersPage = 1;
    loadUsers();
  }, 300));
  ['userRoleFilter', 'userProfileFilter', 'userTelegramFilter', 'userCvFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.usersPage = 1;
      loadUsers();
    });
  });

  // Job search and filter
  document.getElementById('jobSearch')?.addEventListener('input', debounce(() => {
    state.jobsPage = 1;
    loadJobs();
  }, 300));

  ['statusFilter', 'jobCategoryFilter', 'sourceTypeFilter', 'verificationFilter', 'countyFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.jobsPage = 1;
      loadJobs();
    });
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

  fillCountySelects();
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
