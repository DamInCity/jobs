/**
 * Mobile-first setup wizard: alerts, AI resume, Telegram, email.
 * Usage: startSetupWizard({ profile, force })
 */
(function () {
  const KEY = 'jobshub-wizard-done';

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function channelsOf(profile) {
    return Array.isArray(profile?.notify_channels) ? profile.notify_channels : ['email'];
  }

  function stepsFor(profile) {
    const emailOn = channelsOf(profile).includes('email');
    const tgOn = !!profile?.telegram_linked;
    const cvOn = !!profile?.has_cv;
    return [
      {
        id: 'welcome',
        kicker: 'Setup',
        title: 'Get JobsHub working for you',
        body: 'Four taps. Alerts, Resume AI, Telegram, and email. You can skip any step.',
        cta: 'Start',
      },
      {
        id: 'email',
        kicker: '1 / 4  Email',
        title: 'Job emails',
        body: emailOn
          ? `Emails are on for ${profile.email || 'your account'}. Matching jobs land in your inbox.`
          : 'Turn on email so you don’t miss roles that match your profile.',
        done: emailOn,
        cta: emailOn ? 'Next' : 'Open alerts',
        href: '/alerts',
      },
      {
        id: 'telegram',
        kicker: '2 / 4  Telegram',
        title: 'Chat with the bot',
        body: tgOn
          ? 'Telegram is linked. Use Interview and Tailor CV in the bot — no typing job IDs.'
          : 'Link Telegram for job pings, tailored PDFs, and interview help from your phone.',
        done: tgOn,
        cta: tgOn ? 'Next' : 'Link Telegram',
        action: 'telegram',
      },
      {
        id: 'resume',
        kicker: '3 / 4  Resume AI',
        title: 'Upload your CV',
        body: cvOn
          ? 'Your CV is on file. We parse it with AI (that wait is the parser, not a freeze). Tailor it per job from Profile or Telegram.'
          : 'Upload a PDF. Parsing for AI can take up to a minute — that’s normal.',
        done: cvOn,
        cta: cvOn ? 'Next' : 'Upload on this page',
        href: '#cvForm',
      },
      {
        id: 'alerts',
        kicker: '4 / 4  Alerts',
        title: 'Choose what you hear about',
        body: 'Set categories, locations, and how often. Only matching jobs get through.',
        cta: 'Set alerts',
        href: '/alerts',
      },
      {
        id: 'done',
        kicker: 'Ready',
        title: 'You’re set',
        body: 'Come back to Profile anytime. Replay this guide from the “Setup guide” button.',
        cta: 'Finish',
      },
    ];
  }

  async function linkTelegram() {
    const res = await api('/users/telegram/link-token', { method: 'POST' });
    const url = res.data?.deep_link;
    if (url) window.open(url, '_blank', 'noopener');
    if (typeof showNotification === 'function') {
      showNotification('Finish linking in Telegram, then come back', 'info');
    }
  }

  function markDone() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function shouldAutoStart(opts) {
    if (opts.force) return true;
    const q = new URLSearchParams(location.search);
    if (q.get('wizard') === '1' || q.get('onboarding') === '1') return true;
    try {
      if (localStorage.getItem(KEY) === '1') return false;
    } catch {
      /* show */
    }
    const p = opts.profile || {};
    return !p.has_cv || !p.telegram_linked;
  }

  window.startSetupWizard = function startSetupWizard(opts = {}) {
    if (!shouldAutoStart(opts) && !opts.force) return;
    document.getElementById('setupWizard')?.remove();

    const root = el(`
      <div class="setup-wizard" id="setupWizard" role="dialog" aria-modal="true" aria-labelledby="wizTitle">
        <div class="setup-wizard-sheet">
          <button type="button" class="setup-wizard-skip" data-wiz="skip">Skip</button>
          <div class="setup-wizard-dots" id="wizDots"></div>
          <p class="setup-wizard-kicker" id="wizKicker"></p>
          <h2 class="setup-wizard-title" id="wizTitle"></h2>
          <p class="setup-wizard-body" id="wizBody"></p>
          <p class="setup-wizard-status hidden" id="wizStatus"></p>
          <div class="setup-wizard-actions">
            <button type="button" class="btn btn-ghost btn-block" data-wiz="back">Back</button>
            <button type="button" class="btn btn-primary btn-block" data-wiz="next">Next</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(root);
    document.body.classList.add('wizard-open');

    const steps = stepsFor(opts.profile || window.state?.user || {});
    let i = 0;

    function render() {
      const s = steps[i];
      root.querySelector('#wizKicker').textContent = s.kicker;
      root.querySelector('#wizTitle').textContent = s.title;
      root.querySelector('#wizBody').textContent = s.body;
      const st = root.querySelector('#wizStatus');
      if (s.done) {
        st.textContent = 'Already done';
        st.classList.remove('hidden');
      } else {
        st.classList.add('hidden');
      }
      const next = root.querySelector('[data-wiz="next"]');
      next.textContent = s.cta;
      root.querySelector('[data-wiz="back"]').classList.toggle('hidden', i === 0);
      const dots = root.querySelector('#wizDots');
      dots.innerHTML = steps
        .map((_, n) => `<span class="${n === i ? 'is-on' : ''}"></span>`)
        .join('');
    }

    function close() {
      markDone();
      document.body.classList.remove('wizard-open');
      root.remove();
    }

    async function goNext() {
      const s = steps[i];
      if (s.action === 'telegram' && !s.done) {
        try {
          await linkTelegram();
        } catch (err) {
          if (typeof showNotification === 'function') {
            showNotification(err.message || 'Could not start Telegram link', 'error');
          }
        }
      }
      if (s.href === '#cvForm') {
        close();
        document.getElementById('cvForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('cvPickBtn')?.focus();
        return;
      }
      if (s.href && i === steps.length - 2) {
        // last content step with href still allows Next to finish OR navigate
      }
      if (s.href && !s.done && s.id === 'email') {
        markDone();
        window.location.href = s.href;
        return;
      }
      if (s.href && s.id === 'alerts') {
        markDone();
        window.location.href = s.href;
        return;
      }
      if (i >= steps.length - 1) {
        close();
        return;
      }
      i += 1;
      render();
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-wiz]');
      if (!t) return;
      const act = t.getAttribute('data-wiz');
      if (act === 'skip') close();
      else if (act === 'back') {
        i = Math.max(0, i - 1);
        render();
      } else if (act === 'next') goNext();
    });

    render();
  };

  window.openSetupWizard = function () {
    window.startSetupWizard({ profile: window.state?.user, force: true });
  };
})();
