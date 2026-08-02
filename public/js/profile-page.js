/**
 * Profile hub: account, CV, skills, tailor resume, history
 */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function renderTagList(el, items, emptyText) {
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<span class="text-muted">${escapeHtml(emptyText || 'None')}</span>`;
    return;
  }
  el.innerHTML = items
    .map((t) => `<span class="profile-tag">${escapeHtml(typeof t === 'string' ? t : t.name || t)}</span>`)
    .join('');
}

function renderEditableSkills(skills) {
  const el = document.getElementById('profileSkills');
  if (!el) return;
  if (!skills || !skills.length) {
    el.innerHTML = '<span class="text-muted">No skills yet</span>';
    return;
  }
  el.innerHTML = skills
    .map(
      (skill, index) => `
      <span class="profile-tag profile-tag-removable" data-skill-index="${index}">
        ${escapeHtml(skill)}
        <button type="button" class="profile-tag-remove" data-remove-skill="${index}" aria-label="Remove ${escapeHtml(skill)}">
          ×
        </button>
      </span>`
    )
    .join('');

  el.querySelectorAll('[data-remove-skill]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-remove-skill'), 10);
      const next = [...(state.user.skills || [])];
      next.splice(idx, 1);
      await saveSkills(next);
    });
  });
}

async function saveSkills(skills) {
  const res = await api('/users/profile', {
    method: 'PUT',
    body: JSON.stringify({ skills }),
  });
  state.user = res.data;
  applyProfile(state.user);
  showNotification('Skills updated', 'success');
}

function applyProfile(profile) {
  if (!profile) return;

  const nameEl = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  if (nameEl) nameEl.value = profile.name || '';
  if (emailEl) emailEl.value = profile.email || '';

  const cvStatus = document.getElementById('cvStatus');
  const cvRemoveBtn = document.getElementById('cvRemoveBtn');
  const parseBtn = document.getElementById('parseResumeBtn');
  const reprofileBtn = document.getElementById('reprofileBtn');

  if (profile.has_cv) {
    if (cvStatus) {
      cvStatus.textContent = `Uploaded: ${profile.cv_original_name || 'CV'}${
        profile.cv_uploaded_at ? ` · ${formatDate(profile.cv_uploaded_at)}` : ''
      }`;
    }
    cvRemoveBtn?.classList.remove('hidden');
    parseBtn?.classList.remove('hidden');
    reprofileBtn?.classList.remove('hidden');
  } else {
    if (cvStatus) cvStatus.textContent = 'No CV uploaded yet.';
    cvRemoveBtn?.classList.add('hidden');
    parseBtn?.classList.add('hidden');
    reprofileBtn?.classList.add('hidden');
  }

  const statusLine = document.getElementById('profileStatusLine');
  const summary = document.getElementById('profileSummary');
  const seniority = document.getElementById('profileSeniority');
  const confirmBtn = document.getElementById('confirmProfileBtn');

  const hasSkills = !!(profile.skills && profile.skills.length);
  const hasCats = !!(profile.preferred_categories && profile.preferred_categories.length);
  const hasCv = !!profile.has_cv;

  if (statusLine) {
    if (profile.profile_status === 'pending_confirm' && hasCv) {
      statusLine.textContent = 'Review suggested skills & categories, then confirm.';
    } else if (hasSkills || hasCats) {
      statusLine.textContent =
        profile.profile_status === 'confirmed'
          ? 'Profile active — digests use your skills & categories.'
          : 'Profile ready. Confirm when you’re happy with it.';
    } else {
      statusLine.textContent = 'Add skills manually or upload a CV to get suggestions.';
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
    (profile.preferred_categories || []).map((id) => id);
  renderTagList(document.getElementById('profileCategories'), catNames, 'No categories yet');
  renderEditableSkills(profile.skills || []);
  renderTagList(
    document.getElementById('profileLocations'),
    profile.preferred_locations || [],
    'No preferred locations'
  );

  if (confirmBtn) {
    const needsConfirm =
      profile.profile_status === 'pending_confirm' && (hasSkills || hasCats || hasCv);
    confirmBtn.classList.toggle('hidden', !needsConfirm);
  }

  const tg = document.getElementById('telegramHint');
  if (tg) {
    if (profile.telegram_linked) {
      tg.innerHTML = `Telegram linked${
        profile.telegram_username ? ` (@${escapeHtml(profile.telegram_username)})` : ''
      }. Use <code>/resume</code> in the bot to tailor a CV. Manage link on <a href="/alerts">Alerts</a>.`;
    } else {
      tg.innerHTML =
        'Telegram not linked. Open <a href="/alerts">Job Alerts</a> → Link Telegram for digests and <code>/resume</code>.';
    }
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
    if (!response.ok) throw new Error(data.message || 'Upload failed');
    state.user = data.data;
    applyProfile(data.data);
    showNotification(data.message || 'CV uploaded', 'success');
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
  if (!confirm('Remove your CV from the server?')) return;
  try {
    await api('/users/cv', { method: 'DELETE' });
    const profile = await api('/users/profile');
    state.user = profile.data;
    applyProfile(profile.data);
    showNotification('CV removed', 'success');
  } catch (error) {
    showNotification(error.message || 'Remove failed', 'error');
  }
}

async function confirmProfile() {
  try {
    const res = await api('/users/profile/confirm', { method: 'POST', body: JSON.stringify({}) });
    state.user = res.data;
    applyProfile(res.data);
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
    applyProfile(res.data);
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

async function parseMasterResume() {
  const btn = document.getElementById('parseResumeBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Parsing…';
  }
  try {
    const res = await api('/users/resume/parse', { method: 'POST', body: JSON.stringify({}) });
    showNotification(
      res.message ||
        `Parsed: ${res.data?.work_count || 0} roles, ${res.data?.skills_count || 0} skills`,
      'success'
    );
  } catch (error) {
    showNotification(error.message || 'Parse failed', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-brain"></i> Parse for AI';
    }
  }
}

function setLlmPill(configured) {
  const el = document.getElementById('llmStatus');
  if (!el) return;
  if (configured) {
    el.className = 'llm-pill ok';
    el.innerHTML = '<i class="fas fa-check-circle"></i> Resume AI ready (SiliconFlow)';
  } else {
    el.className = 'llm-pill off';
    el.innerHTML =
      '<i class="fas fa-exclamation-triangle"></i> Resume AI not configured — set SILICONFLOW_API_KEY';
  }
}

async function loadResumeStatus() {
  try {
    const res = await api('/users/resume/status');
    setLlmPill(!!res.data?.llm_configured);
  } catch {
    setLlmPill(false);
  }
}

async function loadCandidates() {
  const list = document.getElementById('candidatesList');
  const empty = document.getElementById('candidatesEmpty');
  if (!list) return;
  try {
    const res = await api('/users/resume/candidates?limit=8');
    const jobs = res.data || [];
    if (!jobs.length) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    list.innerHTML = jobs
      .map((j) => {
        const src = j.source || 'match';
        const badgeClass = src === 'saved' ? '' : src === 'match' ? 'match' : 'recent';
        const badgeLabel = src === 'saved' ? 'Saved' : src === 'match' ? 'Match' : 'Recent';
        return `
          <div class="candidate-row" data-job-id="${escapeHtml(j.id)}">
            <div class="candidate-meta">
              <strong>${escapeHtml(j.title || 'Role')}</strong>
              <span>${escapeHtml(j.company_name || '')}${
                j.location ? ` · ${escapeHtml(j.location)}` : ''
              }</span>
              <span class="badge-src ${badgeClass}" style="margin-top:0.35rem;display:inline-block">${badgeLabel}</span>
            </div>
            <button type="button" class="btn btn-primary btn-sm tailor-btn" data-job-id="${escapeHtml(j.id)}">
              <i class="fas fa-wand-magic-sparkles"></i> Tailor CV
            </button>
          </div>`;
      })
      .join('');

    list.querySelectorAll('.tailor-btn').forEach((btn) => {
      btn.addEventListener('click', () => tailorForJob(btn.getAttribute('data-job-id'), btn));
    });
  } catch (error) {
    list.innerHTML = `<p class="text-muted">${escapeHtml(error.message || 'Failed to load jobs')}</p>`;
  }
}

async function tailorForJob(jobId, btn) {
  if (!jobId) return;
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
  }
  try {
    const res = await api('/users/resume/tailor', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
    });
    showNotification(res.message || 'Tailored CV ready', 'success');
    if (res.data?.changes_summary) {
      showNotification(String(res.data.changes_summary).split('\n')[0], 'info');
    }
    await loadTailoredHistory();
    if (res.data?.id) {
      await downloadTailored(res.data.id, res.data.original_name);
    }
  } catch (error) {
    showNotification(error.message || 'Tailor failed', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || '<i class="fas fa-wand-magic-sparkles"></i> Tailor CV';
    }
  }
}

async function downloadTailored(id, filename) {
  const response = await fetch(`/api/users/resume/tailored/${id}/download`, {
    headers: {
      ...(state.token && { Authorization: `Bearer ${state.token}` }),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'tailored-cv.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadTailoredHistory() {
  const empty = document.getElementById('tailoredEmpty');
  const table = document.getElementById('tailoredTable');
  const body = document.getElementById('tailoredBody');
  if (!body) return;
  try {
    const res = await api('/users/resume/tailored');
    const rows = res.data || [];
    if (!rows.length) {
      empty?.classList.remove('hidden');
      table?.classList.add('hidden');
      body.innerHTML = '';
      return;
    }
    empty?.classList.add('hidden');
    table?.classList.remove('hidden');
    body.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(formatDate(r.created_at))}</td>
        <td>
          <strong>${escapeHtml(r.job_title || 'Role')}</strong><br>
          <span class="text-muted">${escapeHtml(r.company_name || '')}</span>
        </td>
        <td class="changes-cell">${escapeHtml(r.changes_summary || '')}</td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-primary btn-sm dl-tailored" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.original_name || 'tailored-cv.pdf')}" aria-label="Download">
            <i class="fas fa-download"></i>
          </button>
          <button type="button" class="btn btn-ghost btn-sm del-tailored" data-id="${escapeHtml(r.id)}" aria-label="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`
      )
      .join('');

    body.querySelectorAll('.dl-tailored').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await downloadTailored(btn.getAttribute('data-id'), btn.getAttribute('data-name'));
        } catch (error) {
          showNotification(error.message || 'Download failed', 'error');
        }
      });
    });

    body.querySelectorAll('.del-tailored').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this tailored resume?')) return;
        try {
          await api(`/users/resume/tailored/${btn.getAttribute('data-id')}`, {
            method: 'DELETE',
          });
          showNotification('Deleted', 'success');
          await loadTailoredHistory();
        } catch (error) {
          showNotification(error.message || 'Delete failed', 'error');
        }
      });
    });
  } catch (error) {
    if (empty) {
      empty.classList.remove('hidden');
      empty.textContent = error.message || 'Could not load history';
    }
  }
}

async function initProfilePage() {
  initCommonNav();

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const loading = document.getElementById('profileLoading');
  const guest = document.getElementById('profileGuest');
  const app = document.getElementById('profileApp');

  const authed = await checkAuth();
  loading?.classList.add('hidden');

  if (!authed) {
    guest?.classList.remove('hidden');
    app?.classList.add('hidden');
    return;
  }

  guest?.classList.add('hidden');
  app?.classList.remove('hidden');

  try {
    const res = await api('/users/profile');
    state.user = res.data;
    applyProfile(res.data);
  } catch (error) {
    showNotification(error.message || 'Failed to load profile', 'error');
  }

  await Promise.all([loadResumeStatus(), loadCandidates(), loadTailoredHistory()]);

  document.getElementById('accountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('profileName')?.value?.trim();
      const res = await api('/users/profile', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      state.user = res.data;
      applyProfile(res.data);
      showNotification('Name saved', 'success');
    } catch (error) {
      showNotification(error.message || 'Save failed', 'error');
    }
  });

  document.getElementById('emailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/users/change-email', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('newEmail')?.value,
          password: document.getElementById('emailPassword')?.value,
        }),
      });
      if (res.data?.token) {
        localStorage.setItem('token', res.data.token);
        state.token = res.data.token;
      }
      showNotification(res.message || 'Email updated', 'success');
      document.getElementById('emailForm')?.reset();
      const profile = await api('/users/profile');
      state.user = profile.data;
      applyProfile(profile.data);
    } catch (error) {
      showNotification(error.message || 'Email change failed', 'error');
    }
  });

  document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const np = document.getElementById('newPassword')?.value;
    const cp = document.getElementById('confirmPassword')?.value;
    if (np !== cp) {
      showNotification('Passwords do not match', 'error');
      return;
    }
    try {
      await api('/users/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: document.getElementById('currentPassword')?.value,
          new_password: np,
        }),
      });
      showNotification('Password updated', 'success');
      document.getElementById('passwordForm')?.reset();
    } catch (error) {
      showNotification(error.message || 'Password change failed', 'error');
    }
  });

  document.getElementById('cvPickBtn')?.addEventListener('click', () => {
    document.getElementById('cvFile')?.click();
  });
  document.getElementById('cvFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadCv(file);
    e.target.value = '';
  });
  document.getElementById('cvRemoveBtn')?.addEventListener('click', removeCv);
  document.getElementById('parseResumeBtn')?.addEventListener('click', parseMasterResume);
  document.getElementById('confirmProfileBtn')?.addEventListener('click', confirmProfile);
  document.getElementById('reprofileBtn')?.addEventListener('click', reprofileCv);

  document.getElementById('addSkillBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('skillInput');
    const skill = input?.value?.trim();
    if (!skill) return;
    const skills = [...(state.user?.skills || [])];
    if (skills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      showNotification('Skill already on your profile', 'info');
      return;
    }
    skills.push(skill);
    input.value = '';
    await saveSkills(skills);
  });
  document.getElementById('skillInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('addSkillBtn')?.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', initProfilePage);
