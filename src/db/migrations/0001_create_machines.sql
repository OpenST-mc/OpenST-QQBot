-- 机器作品目录，取代 public/database/database.json 的执行期读取
-- status 取值必须与 src/db/enums.ts 的 REVIEW_STATUSES 保持一致
CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL,
  preview_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  sub_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'approved', 'rejected', 'deprecated', 'disputed', 'legacy_review'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_machines_status ON machines(status);

-- 机器标签，用于关键字推荐；一个机器可有多个标签
-- 标签内容不做大小写归一化，重复标签依赖复合主键去重
CREATE TABLE machine_tags (
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (machine_id, tag)
);

CREATE INDEX idx_machine_tags_tag ON machine_tags(tag);
