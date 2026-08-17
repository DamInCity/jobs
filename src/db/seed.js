const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');
const { categories } = require('./categories');

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

    // Refresh category counts from real jobs only (no sample/demo listings)
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
