#!/usr/bin/env node
/**
 * 数据库初始化脚本
 * 在 Railway 容器启动时直接创建 SQLite 表，不依赖 prisma CLI
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dbUrl = process.env.DATABASE_URL || 'file:/app/db/custom.db';
const dbPath = dbUrl.replace('file:', '');
const dbDir = path.dirname(dbPath);

// 确保数据库目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created database directory: ${dbDir}`);
}

console.log(`Initializing database at: ${dbPath}`);

// 使用 better-sqlite3 或原生 sqlite3 创建表
// 由于项目使用 Prisma，我们直接用 SQL 创建表
const Database = (() => {
  try {
    return require('better-sqlite3');
  } catch (e) {
    return null;
  }
})();

if (Database) {
  const db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      descriptionOss TEXT,
      cover TEXT,
      coverOss TEXT,
      genre TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      wordCount INTEGER NOT NULL DEFAULT 0,
      outlineOss TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      novelId TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      contentOss TEXT,
      wordCount INTEGER NOT NULL DEFAULT 0,
      "order" INTEGER NOT NULL DEFAULT 0,
      isPublished INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novelId) REFERENCES novels(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS chapters_novelId ON chapters(novelId);
    
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novelId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      avatar TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (novelId) REFERENCES novels(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS characters_novelId ON characters(novelId);
  `);
  
  db.close();
  console.log('Database initialized successfully!');
} else {
  // 尝试使用 prisma migrate 或 db push
  try {
    console.log('better-sqlite3 not found, trying prisma...');
    // 查找 prisma 可执行文件
    const prismaPaths = [
      '/app/node_modules/.bin/prisma',
      './node_modules/.bin/prisma',
      path.join(__dirname, '../node_modules/.bin/prisma'),
    ];
    
    let prismaPath = null;
    for (const p of prismaPaths) {
      if (fs.existsSync(p)) {
        prismaPath = p;
        break;
      }
    }
    
    if (prismaPath) {
      execSync(`${prismaPath} db push --schema=${path.join(__dirname, '../prisma/schema.prisma')}`, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: dbUrl }
      });
    } else {
      console.log('Prisma not found, database will be initialized by Prisma client on first use');
    }
  } catch (e) {
    console.error('Failed to initialize database:', e.message);
  }
}
