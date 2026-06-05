const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');
const slugify = require('slugify');

const categories = [
  { name: 'Software Development', slug: 'software-development', icon: 'code', description: 'Programming, engineering, and software development roles' },
  { name: 'Design', slug: 'design', icon: 'palette', description: 'UI/UX, graphic design, and creative roles' },
  { name: 'Marketing', slug: 'marketing', icon: 'megaphone', description: 'Digital marketing, content, and growth roles' },
  { name: 'Sales', slug: 'sales', icon: 'chart-line', description: 'Sales, business development, and account management' },
  { name: 'Customer Support', slug: 'customer-support', icon: 'headset', description: 'Customer service and support roles' },
  { name: 'Finance', slug: 'finance', icon: 'calculator', description: 'Accounting, finance, and banking roles' },
  { name: 'Human Resources', slug: 'human-resources', icon: 'users', description: 'HR, recruiting, and people operations' },
  { name: 'Data Science', slug: 'data-science', icon: 'chart-bar', description: 'Data analysis, machine learning, and AI roles' },
  { name: 'DevOps', slug: 'devops', icon: 'server', description: 'Cloud, infrastructure, and DevOps engineering' },
  { name: 'Product', slug: 'product', icon: 'lightbulb', description: 'Product management and strategy roles' },
  { name: 'Operations', slug: 'operations', icon: 'cogs', description: 'Operations, logistics, and project management' },
  { name: 'Other', slug: 'other', icon: 'briefcase', description: 'Other professional roles' },
];

const sampleJobs = [
  {
    title: 'Senior Full Stack Developer',
    company_name: 'TechCorp Kenya',
    company_logo_url: 'https://ui-avatars.com/api/?name=TechCorp&background=0D9488&color=fff',
    description: `<p>We're looking for an experienced Full Stack Developer to join our growing engineering team.</p>
    <h3>What you'll do:</h3>
    <ul>
      <li>Build and maintain web applications using React and Node.js</li>
      <li>Design and implement RESTful APIs</li>
      <li>Collaborate with product and design teams</li>
      <li>Mentor junior developers</li>
    </ul>`,
    requirements: `<ul>
      <li>5+ years of experience in web development</li>
      <li>Strong proficiency in JavaScript/TypeScript</li>
      <li>Experience with React, Node.js, and PostgreSQL</li>
      <li>Bachelor's degree in Computer Science or equivalent</li>
    </ul>`,
    benefits: 'Competitive salary, health insurance, remote work options, professional development budget',
    location: 'Nairobi, Kenya',
    job_type: 'hybrid',
    category_slug: 'software-development',
    salary_min: 120000,
    salary_max: 180000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/senior-fullstack',
    is_featured: true,
  },
  {
    title: 'UI/UX Designer',
    company_name: 'DesignHub',
    company_logo_url: 'https://ui-avatars.com/api/?name=DesignHub&background=8B5CF6&color=fff',
    description: `<p>Join our creative team as a UI/UX Designer and help shape the future of our products.</p>
    <h3>Responsibilities:</h3>
    <ul>
      <li>Create wireframes, prototypes, and high-fidelity designs</li>
      <li>Conduct user research and usability testing</li>
      <li>Collaborate with developers to implement designs</li>
    </ul>`,
    requirements: `<ul>
      <li>3+ years of UI/UX design experience</li>
      <li>Proficiency in Figma and Adobe Creative Suite</li>
      <li>Strong portfolio demonstrating design process</li>
    </ul>`,
    benefits: 'Creative freedom, flexible hours, design tool subscriptions',
    location: 'Remote',
    job_type: 'remote',
    category_slug: 'design',
    salary_min: 80000,
    salary_max: 120000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/uiux-designer',
    is_featured: true,
  },
  {
    title: 'Digital Marketing Manager',
    company_name: 'GrowthScale',
    company_logo_url: 'https://ui-avatars.com/api/?name=GrowthScale&background=F59E0B&color=fff',
    description: `<p>Lead our digital marketing efforts and drive growth across all channels.</p>`,
    requirements: `<ul>
      <li>5+ years in digital marketing</li>
      <li>Experience with SEO, SEM, and social media marketing</li>
      <li>Data-driven approach with strong analytics skills</li>
    </ul>`,
    benefits: 'Performance bonuses, marketing conference attendance, flexible work',
    location: 'Nairobi, Kenya',
    job_type: 'onsite',
    category_slug: 'marketing',
    salary_min: 100000,
    salary_max: 150000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/marketing-manager',
    is_featured: false,
  },
  {
    title: 'Junior Backend Developer',
    company_name: 'StartupXYZ',
    company_logo_url: 'https://ui-avatars.com/api/?name=StartupXYZ&background=3B82F6&color=fff',
    description: `<p>Great opportunity for a junior developer to grow their skills in a fast-paced startup environment.</p>`,
    requirements: `<ul>
      <li>1-2 years of development experience</li>
      <li>Knowledge of Python or Node.js</li>
      <li>Understanding of databases and REST APIs</li>
    </ul>`,
    benefits: 'Mentorship program, equity options, learning budget',
    location: 'Mombasa, Kenya',
    job_type: 'hybrid',
    category_slug: 'software-development',
    salary_min: 50000,
    salary_max: 80000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/junior-backend',
    is_featured: false,
  },
  {
    title: 'Data Analyst',
    company_name: 'DataDriven Inc',
    company_logo_url: 'https://ui-avatars.com/api/?name=DataDriven&background=10B981&color=fff',
    description: `<p>Analyze data and provide insights to drive business decisions.</p>`,
    requirements: `<ul>
      <li>3+ years of data analysis experience</li>
      <li>Proficiency in SQL and Python</li>
      <li>Experience with data visualization tools</li>
    </ul>`,
    benefits: 'Work from anywhere, competitive salary, health benefits',
    location: 'Remote',
    job_type: 'remote',
    category_slug: 'data-science',
    salary_min: 90000,
    salary_max: 130000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/data-analyst',
    is_featured: true,
  },
  {
    title: 'Customer Success Manager',
    company_name: 'SaaSPro',
    company_logo_url: 'https://ui-avatars.com/api/?name=SaaSPro&background=EC4899&color=fff',
    description: `<p>Build relationships with customers and ensure their success with our platform.</p>`,
    requirements: `<ul>
      <li>2+ years in customer success or account management</li>
      <li>Excellent communication skills</li>
      <li>Experience with SaaS products</li>
    </ul>`,
    benefits: 'Commission structure, remote work, professional development',
    location: 'Nairobi, Kenya',
    job_type: 'hybrid',
    category_slug: 'customer-support',
    salary_min: 70000,
    salary_max: 100000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/customer-success',
    is_featured: false,
  },
];

async function seed() {
  console.log('🌱 Seeding database...');
  
  try {
    // Create admin user
    const hashedPassword = await bcrypt.hash(config.admin.password, 12);
    await db.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3`,
      [config.admin.email, hashedPassword, 'Admin User', 'admin', true]
    );
    console.log('✅ Admin user created/updated');

    // Insert categories
    for (const cat of categories) {
      await db.query(
        `INSERT INTO categories (name, slug, icon, description) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (slug) DO UPDATE SET name = $1, icon = $3, description = $4`,
        [cat.name, cat.slug, cat.icon, cat.description]
      );
    }
    console.log('✅ Categories seeded');

    // Get category IDs
    const catResult = await db.query('SELECT id, slug FROM categories');
    const categoryMap = {};
    catResult.rows.forEach(row => {
      categoryMap[row.slug] = row.id;
    });

    // Insert sample jobs
    for (const job of sampleJobs) {
      const slug = slugify(`${job.title}-${job.company_name}`, { lower: true, strict: true });
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30); // 30 days from now

      await db.query(
        `INSERT INTO jobs (
          title, slug, company_name, company_logo_url, description, requirements, benefits,
          location, job_type, category_id, salary_min, salary_max, salary_currency, salary_period,
          external_link, expiry_date, is_featured
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT DO NOTHING`,
        [
          job.title, slug, job.company_name, job.company_logo_url, job.description,
          job.requirements, job.benefits, job.location, job.job_type,
          categoryMap[job.category_slug], job.salary_min, job.salary_max,
          job.salary_currency, job.salary_period, job.external_link, expiryDate, job.is_featured
        ]
      );
    }
    console.log('✅ Sample jobs seeded');

    console.log('🎉 Database seeding completed!');
    console.log(`\n📧 Admin login: ${config.admin.email}`);
    console.log(`🔑 Admin password: ${config.admin.password}`);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  seed();
}

module.exports = { seed };
