import 'dotenv/config'
import { app } from './index.js'
import { db } from './db.js'

const port = Number(process.env.PORT ?? 8787)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.')
const server = app.listen(port, '127.0.0.1', () => console.log(`Forge API listening on http://127.0.0.1:${port}`))

function close() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
