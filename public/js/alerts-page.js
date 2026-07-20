/**
 * Job Alerts page — create/manage alerts, Telegram link, CV upload
 */

function criteriaSummary(criteria) {
  if (!criteria || typeof criteria !== 'object') return 'Any jobs';
  const parts = [];
  if (criteria.keywords) parts.push(`“${criteria.keywords}”`);
  if (criteria.location) parts.push(criteria.location);
  if (criteria.job_type) parts.push(criteria.job_type);
  if (criteria.category && window.__categoryMap?.[criteria.category]) {
    parts.push(window.__categoryMap[criteria.category]);
  } else if (criteria.category) {
    parts.push('category filter');
  }
  return parts.length ? parts.join(' · ') : 'Any jobs';
}

function formatDate(iso) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function loadCategories() {
  const select = document.getElementById('alertCategory');
  try {
    const res = await api('/categories');
    const cats = res.data || [];
    window.__categoryMap = {};
    cats.forEach((c) => {
      window.__categoryMap[c.id] = c.name;
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select?.appendChild(opt);
    });
  } catch (error) {
    console.warn('Failed to load categories', error);
  }
}

async function loadAlerts() {
  const list = document.getElementById('alertsList');
  if (!list) return;

  try {
    const res = await api('/users/alerts');
    const alerts = res.data || [];

    if (alerts.length === 0) {
      list.innerHTML = '<p class="text-muted">No alerts yet. Create one on the left.</p>';
      return;
    }

    list.innerHTML = alerts
      .map((a) => {
        const criteria =
          typeof a.search_criteria === 'string'
            ? JSON.parse(a.search_criteria)
            : a.search_criteria || {};
        return `
        <div class="alert-item ${a.is_active ? '' : 'inactive'}" data-id="${a.id}">
          <div class="alert-item-main">
            <strong>${escapeHtml(a.name || 'Untitled alert')}</strong>
            <span class="alert-badge">${escapeHtml(a.frequency)}</span>
            ${a.is_active ? '' : '<span class="alert-badge muted">paused</span>'}
            <p class="text-muted">${escapeHtml(criteriaSummary(criteria))}</p>
            <p class="text-muted small">Last sent: ${escapeHtml(formatDate(a.last_sent_at))}</p>
          </div>
          <div class="alert-item-actions">
            <button type="button" class="btn btn-sm btn-ghost" data-toggle-alert="${a.id}" data-active="${a.is_active}">
              ${a.is_active ? 'Pause' : 'Resume'}
            </button>
            <button type="button" class="btn btn-sm btn-ghost danger" data-delete-alert="${a.id}">
              Delete
            </button>
          </div>
        </div>
      `;
      })
      .join('');

    list.querySelectorAll('[data-toggle-alert]').forEach((btn) => {
      btn.addEventListener('click', () => toggleAlert(btn.dataset.toggleAlert, btn.dataset.active === 'true'));
    });
    list.querySelectorAll('[data-delete-alert]').forEach((btn) => {
      btn.addEventListener('click', () => deleteAlert(btn.dataset.deleteAlert));
    });
  } catch (error) {
    list.innerHTML = `<p class="text-muted">Failed to load alerts: ${escapeHtml(error.message)}</p>`;
  }
}

async function createAlert(e) {
  e.preventDefault();
  const name = document.getElementById('alertName')?.value.trim();
  const category = document.getElementById('alertCategory')?.value;
  const location = document.getElementById('alertLocation')?.value.trim();
  const job_type = document.getElementById('alertJobType')?.value;
  const keywords = document.getElementById('alertKeywords')?.value.trim();
  const frequency = document.getElementById('alertFrequency')?.value || 'daily';

  const search_criteria = {};
  if (category) search_criteria.category = category;
  if (location) search_criteria.location = location;
  if (job_type) search_criteria.job_type = job_type;
  if (keywords) search_criteria.keywords = keywords;

  if (Object.keys(search_criteria).length === 0) {
    showNotification('Add at least one filter (category, location, type, or keywords)', 'error');
    return;
  }

  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await api('/users/alerts', {
      method: 'POST',
      body: JSON.stringify({
        name: name || undefined,
        search_criteria,
        frequency,
      }),
    });
    showNotification('Alert created', 'success');
    e.target.reset();
    await loadAlerts();
    // Nudge to link Telegram so category digests can be delivered in chat
    if (state.user && !state.user.telegram_linked) {
      showNotification('Tip: Link Telegram below to get these jobs in chat', 'info');
    }
  } catch (error) {
    showNotification(error.message || 'Failed to create alert', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function toggleAlert(id, isActive) {
  try {
    await api(`/users/alerts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    showNotification(isActive ? 'Alert paused' : 'Alert resumed', 'success');
    await loadAlerts();
  } catch (error) {
    showNotification(error.message || 'Update failed', 'error');
  }
}

async function deleteAlert(id) {
  if (!confirm('Delete this alert?')) return;
  try {
    await api(`/users/alerts/${id}`, { method: 'DELETE' });
    showNotification('Alert deleted', 'success');
    await loadAlerts();
  } catch (error) {
    showNotification(error.message || 'Delete failed', 'error');
  }
}

function applyProfileToChannels(profile) {
  const emailCb = document.getElementById('channelEmail');
  const tgCb = document.getElementById('channelTelegram');
  const status = document.getElementById('telegramStatus');
  const linkBtn = document.getElementById('linkTelegramBtn');
  const unlinkBtn = document.getElementById('unlinkTelegramBtn');
  const emailHint = document.getElementById('channelEmailHint');

  const channels = profile.notify_channels || ['email'];
  if (emailCb) emailCb.checked = channels.includes('email');
  if (emailHint && profile.email) {
    emailHint.textContent = `Alerts go to ${profile.email}`;
  }

  const linked = !!profile.telegram_linked;
  if (tgCb) {
    tgCb.disabled = !linked;
    tgCb.checked = linked && channels.includes('telegram');
  }
  if (status) {
    status.textContent = linked ? 'Linked ✓' : 'Not linked';
    status.classList.toggle('ok', linked);
  }
  if (linkBtn) linkBtn.classList.toggle('hidden', linked);
  if (unlinkBtn) unlinkBtn.classList.toggle('hidden', !linked);

  // CV
  const cvStatus = document.getElementById('cvStatus');
  const cvRemove = document.getElementById('cvRemoveBtn');
  if (profile.has_cv) {
    if (cvStatus) {
      cvStatus.textContent = `Uploaded: ${profile.cv_original_name || 'CV'}${
        profile.cv_uploaded_at ? ` · ${formatDate(profile.cv_uploaded_at)}` : ''
      }`;
    }
    cvRemove?.classList.remove('hidden');
  } else {
    if (cvStatus) cvStatus.textContent = 'No CV uploaded yet.';
    cvRemove?.classList.add('hidden');
  }
}

async function saveChannels() {
  const channels = [];
  if (document.getElementById('channelEmail')?.checked) channels.push('email');
  if (document.getElementById('channelTelegram')?.checked) channels.push('telegram');
  if (channels.length === 0) {
    showNotification('Keep at least one channel enabled', 'error');
    document.getElementById('channelEmail').checked = true;
    channels.push('email');
  }
  try {
    const res = await api('/users/profile', {
      method: 'PUT',
      body: JSON.stringify({ notify_channels: channels }),
    });
    state.user = { ...state.user, ...res.data };
    showNotification('Notification preferences saved', 'success');
  } catch (error) {
    showNotification(error.message || 'Failed to save channels', 'error');
  }
}

async function linkTelegram() {
  const btn = document.getElementById('linkTelegramBtn');
  btn.disabled = true;
  try {
    const res = await api('/users/telegram/link-token', { method: 'POST' });
    const url = res.data.deep_link;
    window.open(url, '_blank', 'noopener');
    showNotification('Complete linking in Telegram, then refresh this page', 'info');
  } catch (error) {
    showNotification(error.message || 'Telegram is not configured on the server', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function unlinkTelegram() {
  if (!confirm('Unlink Telegram from this account?')) return;
  try {
    await api('/users/telegram/link', { method: 'DELETE' });
    showNotification('Telegram unlinked', 'success');
    const res = await api('/users/profile');
    state.user = res.data;
    applyProfileToChannels(res.data);
  } catch (error) {
    showNotification(error.message || 'Unlink failed', 'error');
  }
}

async function uploadCv(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append('cv', file);

  try {
    const response = await fetch('/api/users/cv', {
      method: 'POST',
      headers: {
        ...(state.token && { Authorization: `Bearer ${state.token}` }),
      },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Upload failed');
    }
    showNotification('CV uploaded', 'success');
    const profile = await api('/users/profile');
    state.user = profile.data;
    applyProfileToChannels(profile.data);
  } catch (error) {
    showNotification(error.message || 'Upload failed', 'error');
  }
}

async function removeCv() {
  if (!confirm('Remove your CV?')) return;
  try {
    await api('/users/cv', { method: 'DELETE' });
    showNotification('CV removed', 'success');
    const profile = await api('/users/profile');
    state.user = profile.data;
    applyProfileToChannels(profile.data);
  } catch (error) {
    showNotification(error.message || 'Remove failed', 'error');
  }
}

async function initAlertsPage() {
  initCommonNav();
  const loading = document.getElementById('alertsLoading');
  const guest = document.getElementById('alertsGuest');
  const app = document.getElementById('alertsApp');

  const loggedIn = await checkAuth();
  loading?.classList.add('hidden');

  if (!loggedIn) {
    guest?.classList.remove('hidden');
    return;
  }

  app?.classList.remove('hidden');
  await loadCategories();
  applyProfileToChannels(state.user || {});
  await loadAlerts();

  document.getElementById('createAlertForm')?.addEventListener('submit', createAlert);
  document.getElementById('channelEmail')?.addEventListener('change', saveChannels);
  document.getElementById('channelTelegram')?.addEventListener('change', saveChannels);
  document.getElementById('linkTelegramBtn')?.addEventListener('click', linkTelegram);
  document.getElementById('unlinkTelegramBtn')?.addEventListener('click', unlinkTelegram);

  document.getElementById('cvPickBtn')?.addEventListener('click', () => {
    document.getElementById('cvFile')?.click();
  });
  document.getElementById('cvFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    uploadCv(file);
    e.target.value = '';
  });
  document.getElementById('cvRemoveBtn')?.addEventListener('click', removeCv);

  // Refresh profile when user returns from Telegram
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.token) {
      try {
        const res = await api('/users/profile');
        state.user = res.data;
        applyProfileToChannels(res.data);
      } catch {
        /* ignore */
      }
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAlertsPage);
} else {
  initAlertsPage();
}
