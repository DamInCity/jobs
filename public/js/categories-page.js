/**
 * Categories listing page
 * Default API hides empty categories; optional "show all fields" reveals 0-count cards.
 */

let showingEmpty = false;

async function loadCategoriesPage(includeEmpty = false) {
  const grid = document.getElementById('categoriesGrid');
  const loading = document.getElementById('categoriesLoading');
  const empty = document.getElementById('categoriesEmpty');

  try {
    const q = includeEmpty ? '?include_empty=1' : '';
    const response = await api(`/categories${q}`);
    const categories = response.data || [];

    loading?.classList.add('hidden');

    if (!categories.length) {
      empty?.classList.remove('hidden');
      if (grid) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
            <h3>No open roles categorized yet</h3>
            <p>Browse all jobs while we fill more fields, or show the full category map.</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem">
              <a href="/" class="btn btn-primary">Browse all jobs</a>
              <button type="button" class="btn btn-ghost" id="showEmptyCategoriesBtn">Show all fields (0 roles)</button>
            </div>
          </div>
        `;
        document.getElementById('showEmptyCategoriesBtn')?.addEventListener('click', () => {
          showingEmpty = true;
          empty?.classList.add('hidden');
          loadCategoriesPage(true);
        });
      }
      return;
    }

    empty?.classList.add('hidden');

    grid.innerHTML =
      categories
        .map((cat) => {
          const icon = categoryIconClass(cat.icon);
          const count = Number(cat.job_count) || 0;
          const isEmpty = count === 0;
          if (isEmpty) {
            return `
          <div class="category-card is-empty" aria-disabled="true">
            <div class="category-card-icon">
              <i class="fas ${icon}"></i>
            </div>
            <div class="category-card-body">
              <h3 class="category-card-title">${escapeHtml(cat.name)}</h3>
              <p class="category-card-desc">${escapeHtml(cat.description || 'No open roles in this field right now.')}</p>
              <div class="category-card-meta">
                <span class="category-job-count">
                  <i class="fas fa-briefcase"></i>
                  0 open roles
                </span>
                <span class="category-card-cta muted">Unavailable</span>
              </div>
            </div>
          </div>
        `;
          }
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
                  ${count} open ${count === 1 ? 'role' : 'roles'}
                </span>
                <span class="category-card-cta">Explore <i class="fas fa-arrow-right"></i></span>
              </div>
            </div>
          </a>
        `;
        })
        .join('') +
      `
      <div style="grid-column: 1 / -1; text-align:center; margin-top:0.5rem">
        <button type="button" class="btn btn-ghost btn-sm" id="toggleEmptyCategoriesBtn">
          ${includeEmpty || showingEmpty ? 'Hide empty categories' : 'Show all fields (including 0)'}
        </button>
      </div>
    `;

    document.getElementById('toggleEmptyCategoriesBtn')?.addEventListener('click', () => {
      showingEmpty = !showingEmpty;
      loadCategoriesPage(showingEmpty);
    });
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
  await loadCategoriesPage(false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCategoriesPage);
} else {
  initCategoriesPage();
}
