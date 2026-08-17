# JobsHub - Job Aggregator Platform

A modern, full-featured job aggregator platform where job seekers can browse curated job listings and apply on external company sites. Built with Node.js, Express, PostgreSQL, and vanilla JavaScript.

## 🚀 Features

### For Job Seekers
- 🔍 Advanced search with full-text search capabilities
- 🏷️ Filter by category, location, job type, salary range, and date posted
- 💾 Save favorite jobs (requires account)
- 🔔 Set up job alerts for new matching positions
- 📱 Fully responsive design for mobile and desktop
- ⚡ Fast loading times with optimized queries

### For Administrators
- 📊 Dashboard with key metrics and analytics
- ✏️ Full CRUD operations for job listings
- 📁 Category management
- 👥 User overview
- 🔧 Bulk actions (activate, deactivate, feature, delete)
- 📈 Track views and click-through rates

### Technical Features
- 🔐 JWT-based authentication
- 🛡️ Security headers with Helmet
- ⚡ Rate limiting for API protection
- 📦 Database connection pooling
- 🔄 Automatic job expiry handling
- 📧 Email alert system (background job)
- 🐳 Docker support for easy deployment

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

## 🛠️ Installation

### 1. Clone and Install Dependencies

```bash
cd jobs-website
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jobs_website
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d

# Admin credentials (for initial setup)
ADMIN_EMAIL=admin@jobswebsite.com
ADMIN_PASSWORD=changethispassword

# SiliconFlow (CV profiling + /resume tailor) — https://cloud.siliconflow.cn
SILICONFLOW_API_KEY=
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Qwen/Qwen2.5-72B-Instruct
```

Profile page: `/profile`. Telegram: `/resume` after linking and uploading a master CV.

**PWA:** installable on Android (Chrome “Install app”) and iPhone (Share → Add to Home Screen). Requires HTTPS in production; works on `localhost` for development. Assets: `public/manifest.webmanifest`, `public/sw.js`, `public/icons/`.

**Password reset:** `/forgot-password` → email link → `/reset-password?token=…`. With SMTP unset, non-production responses include a `dev_hint` reset URL in the JSON body.

### 3. Set Up Database

Create the database:

```bash
createdb jobs_website
```

Run migrations:

```bash
npm run migrate
```

Seed with sample data:

```bash
npm run seed
```

### 4. Start the Server

Development mode (with auto-reload):

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The application will be available at `http://localhost:3000`

## 🐳 Docker Deployment

### Using Docker Compose

```bash
# Start all services (PostgreSQL + App)
docker-compose up -d

# Run migrations
docker-compose exec app npm run migrate

# Seed database
docker-compose exec app npm run seed

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### With Nginx (Production)

```bash
docker-compose --profile production up -d
```

## 📁 Project Structure

```
jobs-website/
├── public/                 # Static frontend files
│   ├── admin/             # Admin panel
│   │   └── index.html
│   ├── css/
│   │   ├── main.css       # Main styles
│   │   └── admin.css      # Admin panel styles
│   ├── js/
│   │   ├── main.js        # Frontend JavaScript
│   │   └── admin.js       # Admin panel JavaScript
│   └── index.html         # Main homepage
├── src/
│   ├── config/            # Configuration
│   │   └── index.js
│   ├── db/                # Database
│   │   ├── index.js       # Connection pool
│   │   ├── migrate.js     # Schema migrations
│   │   └── seed.js        # Sample data
│   ├── jobs/              # Background jobs
│   │   └── emailAlerts.js
│   ├── middleware/        # Express middleware
│   │   ├── auth.js        # JWT authentication
│   │   ├── errorHandler.js
│   │   └── validation.js
│   ├── routes/            # API routes
│   │   ├── admin.js
│   │   ├── categories.js
│   │   ├── jobs.js
│   │   └── users.js
│   └── server.js          # Express app
├── nginx/                  # Nginx configuration
│   └── nginx.conf
├── docker-compose.yml
├── Dockerfile
├── ecosystem.config.js     # PM2 configuration
└── package.json
```

## 🔌 API Endpoints

### Public Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/jobs` | List jobs with filters |
| GET | `/api/jobs/:id` | Get job details |
| GET | `/api/jobs/featured` | Get featured jobs |
| GET | `/api/jobs/trending` | Get trending jobs |
| POST | `/api/jobs/:id/view` | Track job view |
| POST | `/api/jobs/:id/click` | Track apply click |
| GET | `/api/categories` | List all categories |
| GET | `/api/categories/:slug` | Get category with jobs |

### User Routes (Authentication Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users/register` | Register new user |
| POST | `/api/users/login` | User login |
| GET | `/api/users/profile` | Get user profile |
| PUT | `/api/users/profile` | Update profile |
| POST | `/api/users/cv` | Upload master CV |
| POST | `/api/users/resume/parse` | Parse master CV to structured resume (LLM) |
| POST | `/api/users/resume/tailor` | Tailor CV for a job (`{ job_id }`) → PDF |
| GET | `/api/users/resume/candidates` | Jobs to tailor against (saved + matches) |
| GET | `/api/users/resume/tailored` | List tailored resume history |
| GET | `/api/users/resume/tailored/:id/download` | Download tailored PDF |
| GET | `/api/users/saved-jobs` | List saved jobs |
| POST | `/api/users/saved-jobs/:jobId` | Save a job |
| DELETE | `/api/users/saved-jobs/:jobId` | Remove saved job |
| GET | `/api/users/alerts` | List job alerts |
| POST | `/api/users/alerts` | Create job alert |
| PUT | `/api/users/alerts/:id` | Update alert |
| DELETE | `/api/users/alerts/:id` | Delete alert |

### Admin Routes (Admin Authentication Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/jobs` | List all jobs |
| POST | `/api/admin/jobs` | Create job |
| PUT | `/api/admin/jobs/:id` | Update job |
| DELETE | `/api/admin/jobs/:id` | Delete job |
| POST | `/api/admin/jobs/bulk` | Bulk actions |
| GET | `/api/admin/categories` | List categories |
| POST | `/api/admin/categories` | Create category |
| PUT | `/api/admin/categories/:id` | Update category |
| DELETE | `/api/admin/categories/:id` | Delete category |
| GET | `/api/admin/users` | List users |

## 🔍 Query Parameters for Job Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Full-text search in title, company, description |
| `category` | UUID/slug | Filter by category |
| `location` | string | Filter by location (partial match) |
| `job_type` | string | Filter by type: remote, hybrid, onsite |
| `salary_min` | number | Minimum salary |
| `salary_max` | number | Maximum salary |
| `posted_after` | string | today, 3days, week, month |
| `featured_only` | boolean | Only featured jobs |
| `remote_only` | boolean | Only remote jobs |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |
| `sort` | string | Sort by: posted_date, title, salary, views |
| `order` | string | Sort order: asc, desc |

## 🔧 Development

### Running Tests

```bash
npm test
```

### Code Linting

```bash
npm run lint
```

### Database Commands

```bash
# Run migrations
npm run migrate

# Seed sample data
npm run seed
```

## 📊 PM2 Production Deployment

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start ecosystem.config.js --env production

# Save PM2 process list
pm2 save

# Set up startup script
pm2 startup
```

## 🔐 Security Considerations

1. **Change default credentials**: Update `ADMIN_EMAIL` and `ADMIN_PASSWORD` in production
2. **Use strong JWT secret**: Generate a random 256-bit key for `JWT_SECRET`
3. **Enable HTTPS**: Configure SSL/TLS in Nginx for production
4. **Database security**: Use strong passwords and limit database access
5. **Rate limiting**: Adjust rate limits based on your traffic patterns

## 🚀 Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Update all passwords and secrets
- [ ] Configure SSL/TLS certificates
- [ ] Set up database backups
- [ ] Configure monitoring (e.g., PM2 monitoring, UptimeRobot)
- [ ] Set up log rotation
- [ ] Test email alert functionality
- [ ] Populate with initial job listings

## 📈 Future Enhancements

- [ ] Redis caching for improved performance
- [ ] Elasticsearch for advanced search
- [ ] Payment integration for featured listings
- [ ] Company profiles and dashboards
- [x] Profile hub + AI resume tailor (`/profile`, Telegram `/resume`, SiliconFlow)
- [ ] API documentation with Swagger
- [ ] Webhook integrations
- [ ] Multi-language support

## 📄 License

MIT License - feel free to use this project for your own job board!

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

Built with ❤️ for job seekers everywhere.
