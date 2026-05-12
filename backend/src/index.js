import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { uploadRouter } from './routes/upload.js'
import { jobsRouter } from './routes/jobs.js'

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(compression())   // gzip/deflate all compressible responses
app.use(express.json())

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'supernova-api-gateway' })
})

// Routes
app.use('/api', uploadRouter)
app.use('/api', jobsRouter)

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`API Gateway running on http://localhost:${PORT}`)
})

export default app
