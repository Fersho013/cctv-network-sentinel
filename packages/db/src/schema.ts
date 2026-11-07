import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('viewer'),
});

export const cameras = sqliteTable('cameras', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ipAddress: text('ip_address').notNull(),
  brand: text('brand').notNull(),
  rtspPort: integer('rtsp_port').notNull().default(554),
  channel: integer('channel').notNull().default(1),
  status: text('status').notNull().default('OFFLINE'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const healthLogs = sqliteTable('health_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').notNull().references(() => cameras.id),
  latency: real('latency').notNull(),
  isRtspActive: integer('is_rtsp_active', { mode: 'boolean' }).notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').references(() => cameras.id),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).notNull().default(false),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
