// tsc 不会输出 .sql，需要在编译后把 migration 复制到 dist 供执行期读取
const fs = require('fs')
const path = require('path')

const source = path.join(__dirname, '..', 'src', 'db', 'migrations')
const destination = path.join(__dirname, '..', 'dist', 'db', 'migrations')

// 先清空目标目录，避免已删除或改名的 migration 残留在 dist 中被重复执行
fs.rmSync(destination, { recursive: true, force: true })
fs.cpSync(source, destination, { recursive: true })
