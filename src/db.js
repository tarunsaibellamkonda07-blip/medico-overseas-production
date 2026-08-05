const { Sequelize, DataTypes } = require('sequelize');

let sequelize;

if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'mysql',
    logging: false,
  });
} else {
  const ssl = String(process.env.DB_SSL).toLowerCase() === 'true';

  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      dialect: 'mysql',
      logging: false,
      dialectOptions: ssl
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {},
    }
  );
}

const Admin = sequelize.define('Admin', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(190), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'admins', underscored: true });

const Enquiry = sequelize.define('Enquiry', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  phone: { type: DataTypes.STRING(25), allowNull: false },
  email: { type: DataTypes.STRING(190) },
  city: { type: DataTypes.STRING(100) },
  interestedCountry: { type: DataTypes.STRING(100), field: 'interested_country' },
  neetScore: { type: DataTypes.STRING(20), field: 'neet_score' },
  message: { type: DataTypes.TEXT },
  source: { type: DataTypes.STRING(100) },
  status: { type: DataTypes.ENUM('new','contacted','qualified','closed'), defaultValue: 'new' },
  notes: { type: DataTypes.TEXT },
  ipAddress: { type: DataTypes.STRING(64), field: 'ip_address' },
  userAgent: { type: DataTypes.STRING(500), field: 'user_agent' }
}, { tableName: 'enquiries', underscored: true, indexes: [{ fields: ['status'] }, { fields: ['created_at'] }, { fields: ['phone'] }] });

const Blog = sequelize.define('Blog', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(220), allowNull: false },
  slug: { type: DataTypes.STRING(240), allowNull: false, unique: true },
  excerpt: { type: DataTypes.TEXT },
  category: { type: DataTypes.STRING(60), defaultValue: 'general' },
  content: { type: DataTypes.TEXT('long') },
  featuredImage: { type: DataTypes.STRING(500), field: 'featured_image' },
  published: { type: DataTypes.BOOLEAN, defaultValue: false },
  publishedAt: { type: DataTypes.DATE, field: 'published_at' }
}, { tableName: 'blogs', underscored: true, indexes: [{ fields: ['published'] }, { fields: ['category'] }] });


const AdminSession = sequelize.define('AdminSession', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'token_hash' },
  adminId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'admin_id' },
  expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' }
}, { tableName: 'admin_sessions', underscored: true, indexes: [{ fields: ['expires_at'] }] });

module.exports = { sequelize, Admin, Enquiry, Blog, AdminSession };
