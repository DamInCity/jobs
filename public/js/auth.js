/**
 * Sign in / Sign up page logic
 */

function getRedirectTarget() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect') || '/';
  // Only allow same-origin relative paths
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/';
  return redirect;
}

function setFormError(el, message) {
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${escapeHtml(message)}`;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.originalHtml = btn.dataset.originalHtml || btn.innerHTML;
  btn.innerHTML = loading
    ? '<i class="fas fa-spinner fa-spin"></i> Please wait...'
    : btn.dataset.originalHtml;
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('authError');
  const submitBtn = form.querySelector('[type="submit"]');
  const email = form.email.value.trim();
  const password = form.password.value;

  setFormError(errorEl, '');
  setLoading(submitBtn, true);

  try {
    const response = await api('/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    setAuthSession(response.data.token, response.data.user);
    showNotification('Welcome back!', 'success');

    const role = response.data.user?.role;
    if (role === 'admin' && getRedirectTarget() === '/') {
      window.location.href = '/admin';
      return;
    }
    window.location.href = getRedirectTarget();
  } catch (error) {
    setFormError(errorEl, error.message || 'Invalid email or password');
  } finally {
    setLoading(submitBtn, false);
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('authError');
  const successEl = document.getElementById('authSuccess');
  const submitBtn = form.querySelector('[type="submit"]');
  const email = form.email.value.trim();
  const devHint = document.getElementById('devResetHint');

  setFormError(errorEl, '');
  if (successEl) {
    successEl.classList.add('hidden');
    successEl.textContent = '';
  }
  if (devHint) {
    devHint.hidden = true;
    devHint.innerHTML = '';
  }
  setLoading(submitBtn, true);

  try {
    const response = await api('/users/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (successEl) {
      successEl.classList.remove('hidden');
      successEl.innerHTML = `<i class="fas fa-check-circle"></i> ${escapeHtml(
        response.message || 'Check your email for a reset link.'
      )}`;
    }
    showNotification('If that email is registered, a reset link is on the way.', 'success');
    if (response.data?.reset_url && devHint) {
      devHint.hidden = false;
      devHint.innerHTML = `Dev mode (no SMTP): <a href="${escapeHtml(response.data.reset_url)}">open reset link</a>`;
    }
  } catch (error) {
    setFormError(errorEl, error.message || 'Could not start password reset');
  } finally {
    setLoading(submitBtn, false);
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('authError');
  const successEl = document.getElementById('authSuccess');
  const submitBtn = form.querySelector('[type="submit"]');
  const password = form.password.value;
  const confirm = form.confirmPassword?.value;
  const token =
    form.token?.value ||
    document.getElementById('resetToken')?.value ||
    new URLSearchParams(window.location.search).get('token') ||
    '';

  setFormError(errorEl, '');
  if (successEl) {
    successEl.classList.add('hidden');
    successEl.textContent = '';
  }

  if (!token) {
    setFormError(errorEl, 'Missing reset token. Open the link from your email.');
    return;
  }
  if (password.length < 8) {
    setFormError(errorEl, 'Password must be at least 8 characters');
    return;
  }
  if (confirm !== undefined && password !== confirm) {
    setFormError(errorEl, 'Passwords do not match');
    return;
  }

  setLoading(submitBtn, true);
  try {
    const response = await api('/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    if (successEl) {
      successEl.classList.remove('hidden');
      successEl.innerHTML = `<i class="fas fa-check-circle"></i> ${escapeHtml(
        response.message || 'Password updated.'
      )}`;
    }
    showNotification('Password updated — sign in to continue', 'success');
    setTimeout(() => {
      window.location.href = '/login';
    }, 1200);
  } catch (error) {
    setFormError(errorEl, error.message || 'Could not reset password');
  } finally {
    setLoading(submitBtn, false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('authError');
  const submitBtn = form.querySelector('[type="submit"]');
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  const confirm = form.confirmPassword?.value;

  setFormError(errorEl, '');

  if (password.length < 8) {
    setFormError(errorEl, 'Password must be at least 8 characters');
    return;
  }
  if (confirm !== undefined && password !== confirm) {
    setFormError(errorEl, 'Passwords do not match');
    return;
  }

  setLoading(submitBtn, true);

  const telegramRaw = form.telegram_username?.value?.trim() || form.telegramUsername?.value?.trim() || '';
  const telegram_username = telegramRaw.replace(/^@/, '') || undefined;

  try {
    const body = { name, email, password };
    if (telegram_username) body.telegram_username = telegram_username;

    const response = await api('/users/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    setAuthSession(response.data.token, response.data.user);
    showNotification('Account created! Upload your CV to get matched jobs.', 'success');
    // Default onboarding path unless caller specified another redirect
    const redirect = getRedirectTarget();
    window.location.href = redirect === '/' ? '/alerts?onboarding=1' : redirect;
  } catch (error) {
    let message = error.message || 'Registration failed';
    if (error.errors?.length) {
      message = error.errors.map((e) => e.message).join('. ');
    }
    setFormError(errorEl, message);
  } finally {
    setLoading(submitBtn, false);
  }
}

function togglePasswordVisibility(btn) {
  const input = btn.closest('.input-with-icon')?.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<i class="fas fa-eye-slash"></i>'
    : '<i class="fas fa-eye"></i>';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

async function initAuthPage() {
  initCommonNav();
  const loggedIn = await checkAuth();
  const path = window.location.pathname;

  // Already signed in — leave login/register (allow stay on forgot/reset)
  if (
    loggedIn &&
    !new URLSearchParams(window.location.search).has('force') &&
    (path === '/login' || path === '/signin' || path === '/register' || path === '/signup')
  ) {
    window.location.replace(getRedirectTarget());
    return;
  }

  const tokenFromQuery = new URLSearchParams(window.location.search).get('token');
  const tokenInput = document.getElementById('resetToken');
  if (tokenInput && tokenFromQuery) {
    tokenInput.value = tokenFromQuery;
  }

  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
  document.getElementById('forgotForm')?.addEventListener('submit', handleForgotPassword);
  document.getElementById('resetForm')?.addEventListener('submit', handleResetPassword);

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => togglePasswordVisibility(btn));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthPage);
} else {
  initAuthPage();
}
