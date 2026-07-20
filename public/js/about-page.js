/**
 * About page — nav/auth only
 */

async function initAboutPage() {
  initCommonNav();
  await checkAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAboutPage);
} else {
  initAboutPage();
}
