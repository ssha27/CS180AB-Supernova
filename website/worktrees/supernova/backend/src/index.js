import express from 'express'
import cors from 'cors'
import { uploadRouter } from './routes/upload.js'
import { jobsRouter } from './routes/jobs.js'
import { studiesRouter } from './routes/studies.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'supernova-api-gateway' })
})

// Routes
app.use('/api', uploadRouter)
app.use('/api', jobsRouter)
app.use('/api', studiesRouter)

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`API Gateway running on http://localhost:${PORT}`)
})

export default app
