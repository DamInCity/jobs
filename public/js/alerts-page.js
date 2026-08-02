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
    if (linked) {
      status.textContent = profile.telegram_username
        ? `Linked ✓ (@${profile.telegram_username})`
        : 'Linked ✓';
    } else {
      status.textContent = profile.telegram_username
        ? `Not linked (saved @${profile.telegram_username})`
        : 'Not linked';
    }
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

  renderSkillProfile(profile);
}

function renderTagList(el, items, emptyLabel) {
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<span class="text-muted small">${escapeHtml(emptyLabel)}</span>`;
    return;
  }
  el.innerHTML = items
    .map((t) => `<span class="profile-tag">${escapeHtml(typeof t === 'string' ? t : t.name || t)}</span>`)
    .join('');
}

function renderEditableSkills(skills) {
  const el = document.getElementById('profileSkills');
  if (!el) return;
  const list = Array.isArray(skills) ? skills : [];
  if (!list.length) {
    el.innerHTML = '<span class="text-muted small">No skills yet — add some below.</span>';
    return;
  }
  el.innerHTML = list
    .map(
      (skill, index) => `
      <span class="profile-tag profile-tag-removable" data-skill-index="${index}">
        ${escapeHtml(skill)}
        <button type="button" class="profile-tag-remove" data-remove-skill="${index}" aria-label="Remove ${escapeHtml(skill)}">
          &times;
        </button>
      </span>`
    )
    .join('');

  el.querySelectorAll('[data-remove-skill]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(btn.getAttribute('data-remove-skill'), 10);
      removeSkillAt(idx);
    });
  });
}

function getCurrentSkills() {
  const skills = state.user?.skills;
  return Array.isArray(skills) ? [...skills] : [];
}

async function persistSkills(skills) {
  const cleaned = [...new Set(skills.map((s) => String(s).trim()).filter(Boolean))].slice(0, 40);
  const res = await api('/users/profile', {
    method: 'PUT',
    body: JSON.stringify({ skills: cleaned }),
  });
  state.user = { ...state.user, ...res.data };
  applyProfileToChannels(state.user);
  await loadAlerts();
  return res;
}

async function addSkillFromInput() {
  const input = document.getElementById('skillInput');
  const raw = (input?.value || '').trim();
  if (!raw) {
    showNotification('Enter a skill first', 'error');
    return;
  }
  // Allow comma-separated batch add
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const existing = getCurrentSkills();
  const existingLower = new Set(existing.map((s) => s.toLowerCase()));
  let added = 0;
  for (const part of parts) {
    if (existingLower.has(part.toLowerCase())) continue;
    existing.push(part);
    existingLower.add(part.toLowerCase());
    added += 1;
  }
  if (!added) {
    showNotification('Skill already on your profile', 'info');
    if (input) input.value = '';
    return;
  }
  try {
    await persistSkills(existing);
    if (input) input.value = '';
    showNotification(added === 1 ? 'Skill added' : `${added} skills added`, 'success');
  } catch (error) {
    showNotification(error.message || 'Could not save skills', 'error');
  }
}

async function removeSkillAt(index) {
  const skills = getCurrentSkills();
  if (index < 0 || index >= skills.length) return;
  const removed = skills.splice(index, 1)[0];
  try {
    await persistSkills(skills);
    showNotification(`Removed “${removed}”`, 'success');
  } catch (error) {
    showNotification(error.message || 'Could not remove skill', 'error');
  }
}

function renderSkillProfile(profile) {
  const statusLine = document.getElementById('profileStatusLine');
  const details = document.getElementById('profileDetails');
  const summary = document.getElementById('profileSummary');
  const seniority = document.getElementById('profileSeniority');
  const confirmBtn = document.getElementById('confirmProfileBtn');
  const reprofileBtn = document.getElementById('reprofileBtn');

  details?.classList.remove('hidden');

  const hasSkills = !!(profile.skills && profile.skills.length);
  const hasCats = !!(profile.preferred_categories && profile.preferred_categories.length);
  const hasCv = !!profile.has_cv;

  if (statusLine) {
    if (profile.profile_status === 'pending_confirm' && hasCv) {
      statusLine.textContent =
        'CV suggestions ready — confirm when it looks right. You can still add skills manually anytime.';
    } else if (hasSkills || hasCats) {
      statusLine.textContent =
        profile.profile_status === 'confirmed'
          ? 'Profile active — digests use your skills & categories. Add more skills anytime.'
          : 'Your skills drive matching. Upload a CV anytime to suggest more (won’t remove yours).';
    } else {
      statusLine.textContent =
        'Add skills manually below, and/or upload a CV to auto-suggest. Both work together.';
    }
  }

  if (summary) {
    summary.textContent = profile.profile_summary || '';
    summary.classList.toggle('hidden', !profile.profile_summary);
  }
  if (seniority) {
    seniority.textContent = profile.profile_seniority
      ? `Seniority: ${profile.profile_seniority}`
      : '';
  }

  const catNames =
    profile.category_names?.map((c) => c.name) ||
    (profile.preferred_categories || []).map((id) => window.__categoryMap?.[id] || 'Category');
  renderTagList(document.getElementById('profileCategories'), catNames, 'No categories yet (set via alert or CV)');
  renderEditableSkills(profile.skills || []);
  renderTagList(
    document.getElementById('profileLocations'),
    profile.preferred_locations || [],
    'No locations yet'
  );

  if (confirmBtn) {
    const needsConfirm = profile.profile_status === 'pending_confirm' && (hasSkills || hasCats || hasCv);
    confirmBtn.classList.toggle('hidden', !needsConfirm);
  }
  if (reprofileBtn) {
    reprofileBtn.classList.toggle('hidden', !hasCv);
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

function toggleChangeEmailForm(show) {
  const form = document.getElementById('changeEmailForm');
  if (!form) return;
  form.classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('newEmail')?.focus();
  } else {
    form.reset();
  }
}

async function changeEmail(e) {
  e.preventDefault();
  const email = document.getElementById('newEmail')?.value?.trim();
  const password = document.getElementById('emailPassword')?.value || '';
  const btn = document.getElementById('changeEmailSubmit');

  if (!email || !password) {
    showNotification('Email and current password are required', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.dataset.originalHtml || btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating…';
  }

  try {
    const res = await api('/users/change-email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.data?.token) {
      setAuthSession(res.data.token, res.data.user || { ...state.user, email: res.data.user?.email || email });
    } else if (res.data?.user) {
      state.user = { ...state.user, ...res.data.user };
    }
    // Refresh full profile for channel hints
    try {
      const profile = await api('/users/profile');
      state.user = profile.data;
      applyProfileToChannels(profile.data);
    } catch {
      applyProfileToChannels(state.user || {});
    }
    toggleChangeEmailForm(false);
    showNotification('Email updated — use the new address next time you sign in', 'success');
  } catch (error) {
    showNotification(error.message || 'Could not update email', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml || '<i class="fas fa-envelope"></i> Update email';
    }
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
  const pickBtn = document.getElementById('cvPickBtn');
  if (pickBtn) {
    pickBtn.disabled = true;
    pickBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Profiling…';
  }

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
    state.user = data.data;
    applyProfileToChannels(data.data);
    await loadAlerts();
    if (data.data?.profile_error) {
      showNotification(data.message || 'CV uploaded; profiling failed', 'error');
    } else {
      showNotification(data.message || 'CV uploaded and profiled', 'success');
    }
  } catch (error) {
    showNotification(error.message || 'Upload failed', 'error');
  } finally {
    if (pickBtn) {
      pickBtn.disabled = false;
      pickBtn.innerHTML = '<i class="fas fa-upload"></i> Upload CV';
    }
  }
}

async function removeCv() {
  if (!confirm('Remove your CV and skill profile?')) return;
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

async function confirmProfile() {
  try {
    const res = await api('/users/profile/confirm', { method: 'POST', body: JSON.stringify({}) });
    state.user = res.data;
    applyProfileToChannels(res.data);
    await loadAlerts();
    showNotification(res.message || 'Profile confirmed', 'success');
  } catch (error) {
    showNotification(error.message || 'Confirm failed', 'error');
  }
}

async function reprofileCv() {
  const btn = document.getElementById('reprofileBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Working…';
  }
  try {
    const res = await api('/users/cv/reprofile', { method: 'POST', body: JSON.stringify({}) });
    state.user = res.data;
    applyProfileToChannels(res.data);
    await loadAlerts();
    showNotification(res.message || 'Re-profiled', 'success');
  } catch (error) {
    showNotification(error.message || 'Re-profile failed', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync"></i> Re-profile CV';
    }
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

  // Fresh profile (includes skills / CV profile fields)
  try {
    const profile = await api('/users/profile');
    state.user = profile.data;
  } catch {
    /* keep session user */
  }

  if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
    document.getElementById('onboardingBanner')?.removeAttribute('hidden');
  }

  await loadCategories();
  applyProfileToChannels(state.user || {});
  await loadAlerts();

  document.getElementById('createAlertForm')?.addEventListener('submit', createAlert);
  document.getElementById('channelEmail')?.addEventListener('change', saveChannels);
  document.getElementById('channelTelegram')?.addEventListener('change', saveChannels);
  document.getElementById('linkTelegramBtn')?.addEventListener('click', linkTelegram);
  document.getElementById('unlinkTelegramBtn')?.addEventListener('click', unlinkTelegram);
  document.getElementById('changeEmailToggle')?.addEventListener('click', () => {
    const form = document.getElementById('changeEmailForm');
    const hidden = form?.classList.contains('hidden');
    toggleChangeEmailForm(!!hidden);
  });
  document.getElementById('changeEmailCancel')?.addEventListener('click', () => toggleChangeEmailForm(false));
  document.getElementById('changeEmailForm')?.addEventListener('submit', changeEmail);

  document.getElementById('cvPickBtn')?.addEventListener('click', () => {
    document.getElementById('cvFile')?.click();
  });
  document.getElementById('cvFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    uploadCv(file);
    e.target.value = '';
  });
  document.getElementById('cvRemoveBtn')?.addEventListener('click', removeCv);
  document.getElementById('confirmProfileBtn')?.addEventListener('click', confirmProfile);
  document.getElementById('reprofileBtn')?.addEventListener('click', reprofileCv);
  document.getElementById('addSkillBtn')?.addEventListener('click', addSkillFromInput);
  document.getElementById('skillInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkillFromInput();
    }
  });

  // Location chips — click to fill location input
  const locationInput = document.getElementById('alertLocation');
  document.querySelectorAll('.location-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const loc = chip.dataset.location;
      if (locationInput.value === loc) {
        locationInput.value = '';
        document.querySelectorAll('.location-chip').forEach((c) => c.classList.remove('active'));
      } else {
        locationInput.value = loc;
        document.querySelectorAll('.location-chip').forEach((c) => c.classList.toggle('active', c.dataset.location === loc));
      }
      locationInput.focus();
    });
  });

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
