/**
 * Categories listing page
 */

async function loadCategoriesPage() {
  const grid = document.getElementById('categoriesGrid');
  const loading = document.getElementById('categoriesLoading');
  const empty = document.getElementById('categoriesEmpty');

  try {
    const response = await api('/categories');
    const categories = response.data || [];

    loading?.classList.add('hidden');

    if (!categories.length) {
      empty?.classList.remove('hidden');
      return;
    }

    grid.innerHTML = categories
      .map((cat) => {
        const icon = categoryIconClass(cat.icon);
        const count = Number(cat.job_count) || 0;
        return `
          <a href="/?category=${encodeURIComponent(cat.slug)}" class="category-card">
            <div class="category-card-icon">
              <i class="fas ${icon}"></i>
            </div>
            <div class="category-card-body">
              <h3 class="category-card-title">${escapeHtml(cat.name)}</h3>
              <p class="category-card-desc">${escapeHtml(cat.description || 'Browse open roles in this category.')}</p>
              <div class="category-card-meta">
                <span class="category-job-count">
                  <i class="fas fa-briefcase"></i>
                  ${count} open ${count === 1 ? 'job' : 'jobs'}
                </span>
                <span class="category-card-cta">View jobs <i class="fas fa-arrow-right"></i></span>
              </div>
            </div>
          </a>
        `;
      })
      .join('');
  } catch (error) {
    loading?.classList.add('hidden');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
          <h3>Could not load categories</h3>
          <p>${escapeHtml(error.message || 'Please try again later.')}</p>
        </div>
      `;
    }
  }
}

async function initCategoriesPage() {
  initCommonNav();
  await checkAuth();
  await loadCategoriesPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCategoriesPage);
} else {
  initCategoriesPage();
}
