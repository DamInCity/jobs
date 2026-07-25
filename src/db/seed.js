const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');
const slugify = require('slugify');
const { categories } = require('./categories');

const sampleJobs = [
  {
    title: 'Senior Full Stack Developer',
    company_name: 'TechCorp Kenya',
    company_logo_url: 'https://ui-avatars.com/api/?name=TechCorp&background=0D9488&color=fff',
    description: `<p>We're looking for an experienced Full Stack Developer to join our growing engineering team.</p>`,
    requirements: `<ul><li>5+ years of web development</li><li>React, Node.js, PostgreSQL</li></ul>`,
    benefits: 'Competitive salary, health insurance, remote work options',
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
    description: `<p>Join our creative team as a UI/UX Designer.</p>`,
    requirements: `<ul><li>3+ years UI/UX</li><li>Figma proficiency</li></ul>`,
    benefits: 'Creative freedom, flexible hours',
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
    description: `<p>Lead digital marketing across channels.</p>`,
    requirements: `<ul><li>5+ years digital marketing</li><li>SEO/SEM experience</li></ul>`,
    benefits: 'Performance bonuses, flexible work',
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
    title: 'Registered Nurse — Medical Ward',
    company_name: 'Nairobi Care Hospital',
    company_logo_url: 'https://ui-avatars.com/api/?name=NCH&background=EF4444&color=fff',
    description: `<p>Provide bedside nursing care on a busy medical ward. Shift work with a supportive clinical team.</p>`,
    requirements: `<ul><li>Valid nursing license (Kenya)</li><li>2+ years hospital experience</li><li>BLS certification</li></ul>`,
    benefits: 'Medical cover, shift allowance, CPD support',
    location: 'Nairobi, Kenya',
    job_type: 'onsite',
    category_slug: 'healthcare',
    salary_min: 70000,
    salary_max: 110000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/registered-nurse-ward',
    is_featured: true,
  },
  {
    title: 'Primary School Teacher (Maths & Science)',
    company_name: 'Greenfield Academy',
    company_logo_url: 'https://ui-avatars.com/api/?name=GFA&background=3B82F6&color=fff',
    description: `<p>Teach upper primary maths and science in a progressive private school.</p>`,
    requirements: `<ul><li>Bachelor of Education</li><li>TSC registration preferred</li><li>2+ years classroom experience</li></ul>`,
    benefits: 'School fees discount, housing stipend',
    location: 'Kiambu, Kenya',
    job_type: 'onsite',
    category_slug: 'education',
    salary_min: 55000,
    salary_max: 85000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/primary-teacher-maths',
    is_featured: true,
  },
  {
    title: 'Social Worker — Child Protection',
    company_name: 'Hope Community Initiative',
    company_logo_url: 'https://ui-avatars.com/api/?name=HCI&background=10B981&color=fff',
    description: `<p>Case management and community outreach for vulnerable children and families.</p>`,
    requirements: `<ul><li>Degree in Social Work or related field</li><li>Experience with child protection frameworks</li></ul>`,
    benefits: 'Field allowance, training budget',
    location: 'Kisumu, Kenya',
    job_type: 'hybrid',
    category_slug: 'social-work',
    salary_min: 60000,
    salary_max: 90000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/social-worker-cp',
    is_featured: false,
  },
  {
    title: 'Legal Officer',
    company_name: 'Horizon Advocates LLP',
    company_logo_url: 'https://ui-avatars.com/api/?name=HAL&background=6366F1&color=fff',
    description: `<p>Support commercial and employment matters for SME clients.</p>`,
    requirements: `<ul><li>LLB and admission to the bar (or pending)</li><li>Strong drafting skills</li></ul>`,
    benefits: 'Mentorship, bar fees support',
    location: 'Nairobi, Kenya',
    job_type: 'hybrid',
    category_slug: 'legal',
    salary_min: 80000,
    salary_max: 130000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/legal-officer',
    is_featured: false,
  },
  {
    title: 'Hotel Front Desk Receptionist',
    company_name: 'Safari Lodge Group',
    company_logo_url: 'https://ui-avatars.com/api/?name=SLG&background=F97316&color=fff',
    description: `<p>Welcome guests, manage check-in/out, and coordinate guest requests.</p>`,
    requirements: `<ul><li>Hospitality diploma preferred</li><li>Customer service experience</li><li>Fluent English; Swahili a plus</li></ul>`,
    benefits: 'Meals on duty, service charge',
    location: 'Mombasa, Kenya',
    job_type: 'onsite',
    category_slug: 'hospitality',
    salary_min: 35000,
    salary_max: 50000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/hotel-receptionist',
    is_featured: false,
  },
  {
    title: 'Civil Engineer — Roads',
    company_name: 'BuildRight Contractors',
    company_logo_url: 'https://ui-avatars.com/api/?name=BRC&background=78716C&color=fff',
    description: `<p>Supervise road works, quality control, and contractor coordination.</p>`,
    requirements: `<ul><li>BSc Civil Engineering</li><li>3+ years site experience</li><li>EBK registration preferred</li></ul>`,
    benefits: 'Site allowance, transport',
    location: 'Nakuru, Kenya',
    job_type: 'onsite',
    category_slug: 'construction-trades',
    salary_min: 100000,
    salary_max: 160000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/civil-engineer-roads',
    is_featured: true,
  },
  {
    title: 'Warehouse Supervisor',
    company_name: 'FastTrack Logistics',
    company_logo_url: 'https://ui-avatars.com/api/?name=FTL&background=0EA5E9&color=fff',
    description: `<p>Lead receiving, inventory accuracy, and dispatch for a regional warehouse.</p>`,
    requirements: `<ul><li>2+ years warehouse leadership</li><li>WMS familiarity</li></ul>`,
    benefits: 'Overtime pay, medical cover',
    location: 'Athi River, Kenya',
    job_type: 'onsite',
    category_slug: 'logistics',
    salary_min: 65000,
    salary_max: 95000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/warehouse-supervisor',
    is_featured: false,
  },
  {
    title: 'Farm Manager — Horticulture',
    company_name: 'Rift Valley Farms',
    company_logo_url: 'https://ui-avatars.com/api/?name=RVF&background=22C55E&color=fff',
    description: `<p>Manage greenhouse production, harvest planning, and farm labour teams.</p>`,
    requirements: `<ul><li>Degree/diploma in agriculture</li><li>Crop production experience</li></ul>`,
    benefits: 'Housing on farm, performance bonus',
    location: 'Naivasha, Kenya',
    job_type: 'onsite',
    category_slug: 'agriculture',
    salary_min: 70000,
    salary_max: 110000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/farm-manager',
    is_featured: false,
  },
  {
    title: 'Electrician',
    company_name: 'PowerFix Services',
    company_logo_url: 'https://ui-avatars.com/api/?name=PFS&background=EAB308&color=fff',
    description: `<p>Install and maintain electrical systems for commercial clients.</p>`,
    requirements: `<ul><li>NITA/EPRA related certification</li><li>3+ years field experience</li></ul>`,
    benefits: 'Tool allowance, overtime',
    location: 'Nairobi, Kenya',
    job_type: 'onsite',
    category_slug: 'skilled-trades',
    salary_min: 45000,
    salary_max: 75000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/electrician',
    is_featured: false,
  },
  {
    title: 'County Administrative Officer',
    company_name: 'Public Service Board',
    company_logo_url: 'https://ui-avatars.com/api/?name=PSB&background=64748B&color=fff',
    description: `<p>Coordinate administrative operations and public service delivery at county level.</p>`,
    requirements: `<ul><li>Bachelor's degree in public administration or related</li><li>Integrity clearance</li></ul>`,
    benefits: 'Pension scheme, medical cover',
    location: 'Nyeri, Kenya',
    job_type: 'onsite',
    category_slug: 'government',
    salary_min: 75000,
    salary_max: 120000,
    salary_currency: 'KES',
    salary_period: 'monthly',
    external_link: 'https://example.com/apply/admin-officer-county',
    is_featured: false,
  },
  {
    title: 'Customer Success Manager',
    company_name: 'SaaSPro',
    company_logo_url: 'https://ui-avatars.com/api/?name=SaaSPro&background=EC4899&color=fff',
    description: `<p>Build relationships with customers and ensure their success.</p>`,
    requirements: `<ul><li>2+ years customer success</li><li>Excellent communication</li></ul>`,
    benefits: 'Commission structure, remote work',
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
  {
    title: 'Data Analyst',
    company_name: 'DataDriven Inc',
    company_logo_url: 'https://ui-avatars.com/api/?name=DataDriven&background=10B981&color=fff',
    description: `<p>Analyze data and provide insights to drive business decisions.</p>`,
    requirements: `<ul><li>3+ years data analysis</li><li>SQL and Python</li></ul>`,
    benefits: 'Remote work, health benefits',
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
];

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    const hashedPassword = await bcrypt.hash(config.admin.password, 12);
    await db.query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3`,
      [config.admin.email, hashedPassword, 'Admin User', 'admin', true]
    );
    console.log('✅ Admin user created/updated');

    for (const cat of categories) {
      await db.query(
        `INSERT INTO categories (name, slug, icon, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET name = $1, icon = $3, description = $4`,
        [cat.name, cat.slug, cat.icon, cat.description]
      );
    }
    console.log('✅ Categories seeded');

    const catResult = await db.query('SELECT id, slug FROM categories');
    const categoryMap = {};
    catResult.rows.forEach((row) => {
      categoryMap[row.slug] = row.id;
    });

    for (const job of sampleJobs) {
      const slug = slugify(`${job.title}-${job.company_name}`, { lower: true, strict: true });
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      await db.query(
        `INSERT INTO jobs (
          title, slug, company_name, company_logo_url, description, requirements, benefits,
          location, job_type, category_id, salary_min, salary_max, salary_currency, salary_period,
          external_link, expiry_date, is_featured, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'manual')
        ON CONFLICT (external_link) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          category_id = EXCLUDED.category_id,
          is_featured = EXCLUDED.is_featured,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP`,
        [
          job.title,
          slug,
          job.company_name,
          job.company_logo_url,
          job.description,
          job.requirements,
          job.benefits,
          job.location,
          job.job_type,
          categoryMap[job.category_slug],
          job.salary_min,
          job.salary_max,
          job.salary_currency,
          job.salary_period,
          job.external_link,
          expiryDate,
          job.is_featured,
        ]
      );
    }
    console.log('✅ Sample jobs seeded');

    // Refresh category counts
    await db.query(`
      UPDATE categories c SET job_count = (
        SELECT COUNT(*) FROM jobs j WHERE j.category_id = c.id AND j.status = 'active'
      )
    `);

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

if (require.main === module) {
  seed();
}

module.exports = { seed };
