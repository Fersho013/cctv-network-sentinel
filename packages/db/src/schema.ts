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
  brand: text('brand').notNull().default('Desconocida'),
  ipAddress: text('ip_address').notNull().unique(),
  rtspPort: integer('rtsp_port').notNull().default(554),
  channel: integer('channel').notNull().default(1),
  username: text('username').notNull().default(''),
  passwordEnc: text('password_enc').notNull().default(''),
  streamPath: text('stream_path').notNull().default(''),
  status: text('status').notNull().default('OFFLINE'),
  latencyMs: real('latency_ms').notNull().default(-1),
  rtspOpen: integer('rtsp_open', { mode: 'boolean' }).notNull().default(false),
  httpOpen: integer('http_open', { mode: 'boolean' }).notNull().default(false),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const healthLogs = sqliteTable('health_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id')
    .notNull()
    .references(() => cameras.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('OFFLINE'),
  latencyMs: real('latency_ms').notNull().default(-1),
  rtspOpen: integer('rtsp_open', { mode: 'boolean' }).notNull().default(false),
  httpOpen: integer('http_open', { mode: 'boolean' }).notNull().default(false),
  timestamp: integer('timestamp', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cameraId: integer('camera_id').references(() => cameras.id, { onDelete: 'set null' }),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).notNull().default(false),
  timestamp: integer('timestamp', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type UserRow = typeof users.$inferSelect;
export type CameraRow = typeof cameras.$inferSelect;
export type NewCameraRow = typeof cameras.$inferInsert;
export type HealthLogRow = typeof healthLogs.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
