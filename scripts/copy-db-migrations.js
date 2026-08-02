const fs = require('fs')
const path = require('path')

const source = path.join(__dirname, '..', 'src', 'db', 'migrations')
const destination = path.join(__dirname, '..', 'dist', 'db', 'migrations')

fs.rmSync(destination, { recursive: true, force: true })
fs.cpSync(source, destination, { recursive: true })
