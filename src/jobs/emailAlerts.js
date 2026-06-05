/**
 * Email Alerts Background Job
 * Sends job alerts to users based on their saved search criteria
 * Run via PM2 or cron: node src/jobs/emailAlerts.js
 */

require('dotenv').config();
const db = require('../db');
const config = require('../config');

// Placeholder for email sending - implement with your preferred email service
async function sendEmail(to, subject, html) {
  // TODO: Implement with SendGrid, Mailgun, or Nodemailer
  console.log(`📧 Would send email to ${to}: ${subject}`);
  
  // Example with Nodemailer:
  // const nodemailer = require('nodemailer');
  // const transporter = nodemailer.createTransport({
  //   host: config.email.host,
  //   port: config.email.port,
  //   auth: {
  //     user: config.email.user,
  //     pass: config.email.password,
  //   },
  // });
  // await transporter.sendMail({
  //   from: config.email.from,
  //   to,
  //   subject,
  //   html,
  // });
  
  return true;
}

function buildJobHtml(job) {
  return `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px; color: #111827;">${job.title}</h3>
      <p style="margin: 0 0 8px; color: #6b7280;">${job.company_name} • ${job.location}</p>
      <p style="margin: 0 0 12px; color: #9ca3af; font-size: 14px;">
        ${job.job_type} ${job.salary_min ? `• ${formatSalary(job.salary_min, job.salary_max, job.salary_currency)}` : ''}
      </p>
      <a href="${config.app.url}/jobs/${job.slug}" 
         style="display: inline-block; background-color: #0d9488; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px;">
        View Job
      </a>
    </div>
  `;
}

function formatSalary(min, max, currency = 'KES') {
  if (min && max) return `${currency} ${min.toLocaleString()} - ${max.toLocaleString()}`;
  if (min) return `From ${currency} ${min.toLocaleString()}`;
  if (max) return `Up to ${currency} ${max.toLocaleString()}`;
  return '';
}

function buildEmailTemplate(userName, jobs, alertName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden;">
        <!-- Header -->
        <div style="background-color: #0d9488; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">💼 JobsHub</h1>
        </div>
        
        <!-- Content -->
        <div style="padding: 24px;">
          <h2 style="margin: 0 0 8px; color: #111827;">New Jobs for You!</h2>
          <p style="margin: 0 0 24px; color: #6b7280;">
            Hi ${userName || 'there'},<br>
            We found ${jobs.length} new job${jobs.length > 1 ? 's' : ''} matching your "${alertName}" alert.
          </p>
          
          <!-- Jobs -->
          ${jobs.map(job => buildJobHtml(job)).join('')}
          
          <!-- CTA -->
          <div style="text-align: center; margin-top: 24px;">
            <a href="${config.app.url}" 
               style="display: inline-block; background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View All Jobs
            </a>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">
            You're receiving this because you set up job alerts on JobsHub.
          </p>
          <a href="${config.app.url}/alerts" style="color: #0d9488; font-size: 14px;">
            Manage your alerts
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function findMatchingJobs(criteria, lastSentAt) {
  const conditions = ["j.status = 'active'"];
  const params = [];
  let paramIndex = 1;

  // Only get jobs posted after last alert
  if (lastSentAt) {
    conditions.push(`j.posted_date > $${paramIndex++}`);
    params.push(lastSentAt);
  } else {
    // For new alerts, get jobs from last 24 hours
    conditions.push(`j.posted_date > NOW() - INTERVAL '24 hours'`);
  }

  // Apply search criteria
  if (criteria.keywords) {
    conditions.push(`(j.title ILIKE $${paramIndex} OR j.description ILIKE $${paramIndex})`);
    params.push(`%${criteria.keywords}%`);
    paramIndex++;
  }

  if (criteria.category) {
    conditions.push(`j.category_id = $${paramIndex++}`);
    params.push(criteria.category);
  }

  if (criteria.location) {
    conditions.push(`j.location ILIKE $${paramIndex++}`);
    params.push(`%${criteria.location}%`);
  }

  if (criteria.job_type) {
    conditions.push(`j.job_type = $${paramIndex++}`);
    params.push(criteria.job_type);
  }

  if (criteria.salary_min) {
    conditions.push(`j.salary_max >= $${paramIndex++}`);
    params.push(criteria.salary_min);
  }

  const query = `
    SELECT j.id, j.title, j.slug, j.company_name, j.location, j.job_type, 
           j.salary_min, j.salary_max, j.salary_currency, j.posted_date
    FROM jobs j
    WHERE ${conditions.join(' AND ')}
    ORDER BY j.posted_date DESC
    LIMIT 10
  `;

  const result = await db.query(query, params);
  return result.rows;
}

async function processAlerts(frequency) {
  console.log(`\n🔔 Processing ${frequency} alerts...`);

  try {
    // Get active alerts for this frequency
    const alertsResult = await db.query(`
      SELECT ja.*, u.email, u.name
      FROM job_alerts ja
      JOIN users u ON ja.user_id = u.id
      WHERE ja.is_active = true 
        AND ja.frequency = $1
        AND u.email_verified = true
    `, [frequency]);

    console.log(`Found ${alertsResult.rows.length} active ${frequency} alerts`);

    for (const alert of alertsResult.rows) {
      try {
        const jobs = await findMatchingJobs(alert.search_criteria, alert.last_sent_at);

        if (jobs.length > 0) {
          const emailHtml = buildEmailTemplate(
            alert.name,
            jobs,
            alert.name || 'Job Alert'
          );

          await sendEmail(
            alert.email,
            `${jobs.length} new job${jobs.length > 1 ? 's' : ''} matching your alert`,
            emailHtml
          );

          // Update last_sent_at
          await db.query(
            'UPDATE job_alerts SET last_sent_at = NOW() WHERE id = $1',
            [alert.id]
          );

          console.log(`✅ Sent ${jobs.length} jobs to ${alert.email}`);
        } else {
          console.log(`⏭️ No new jobs for ${alert.email}`);
        }
      } catch (error) {
        console.error(`❌ Failed to process alert ${alert.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ Failed to process alerts:', error);
  }
}

async function run() {
  console.log('🚀 Starting email alerts job...');
  console.log(`📅 Current time: ${new Date().toISOString()}`);

  const hour = new Date().getHours();

  // Run daily alerts in the morning (8 AM)
  if (hour === 8) {
    await processAlerts('daily');
  }

  // Run weekly alerts on Monday morning
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1 && hour === 8) {
    await processAlerts('weekly');
  }

  console.log('\n✨ Email alerts job completed');
  await db.pool.end();
}

// Run if called directly
if (require.main === module) {
  run().catch(console.error);
}

module.exports = { run, processAlerts };
