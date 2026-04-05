import { Router } from 'express'
import fetch from 'node-fetch'
import { query } from '../services/db.js'

const router = Router()
const DICOM_SERVICE_URL = process.env.DICOM_SERVICE_URL || 'http://localhost:5001'

/**
 * GET /api/studies
 * List all studies with aggregated info.
 * Optional query params: patient_id, modality, date_from, date_to
 */
router.get('/studies', async (req, res) => {
  try {
    const { patient_id, modality, date_from, date_to } = req.query
    const conditions = []
    const params = []
    let paramIndex = 1

    if (patient_id) {
      conditions.push(`patient_id ILIKE $${paramIndex++}`)
      params.push(`%${patient_id}%`)
    }
    if (modality) {
      conditions.push(`modality = $${paramIndex++}`)
      params.push(modality)
    }
    if (date_from) {
      conditions.push(`study_date >= $${paramIndex++}`)
      params.push(date_from)
    }
    if (date_to) {
      conditions.push(`study_date <= $${paramIndex++}`)
      params.push(date_to)
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    const result = await query(
      `SELECT
        study_instance_uid,
        MIN(patient_id) AS patient_id,
        MIN(modality) AS modality,
        MIN(study_date) AS study_date,
        COUNT(DISTINCT series_instance_uid) AS series_count,
        COUNT(*) AS instance_count,
        MIN(created_at) AS created_at
      FROM dicom_instances
      ${whereClause}
      GROUP BY study_instance_uid
      ORDER BY MIN(created_at) DESC`,
      params,
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Failed to fetch studies:', err)
    res.status(500).json({ error: 'Failed to fetch studies.' })
  }
})

/**
 * GET /api/studies/:studyUid/series
 * List all series within a study.
 */
router.get('/studies/:studyUid/series', async (req, res) => {
  try {
    const result = await query(
      `SELECT
        series_instance_uid,
        MIN(modality) AS modality,
        COUNT(*) AS instance_count,
        SUM(byte_length) AS total_bytes,
        MIN(created_at) AS created_at
      FROM dicom_instances
      WHERE study_instance_uid = $1
      GROUP BY series_instance_uid
      ORDER BY MIN(created_at)`,
      [req.params.studyUid],
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Failed to fetch series:', err)
    res.status(500).json({ error: 'Failed to fetch series.' })
  }
})

/**
 * POST /api/studies/:studyUid/series/:seriesUid/view
 * Trigger 3D processing for a series stored in the database.
 * Calls the Python service's /process-from-db endpoint.
 */
router.post('/studies/:studyUid/series/:seriesUid/view', async (req, res) => {
  try {
    const response = await fetch(`${DICOM_SERVICE_URL}/process-from-db`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyUid: req.params.studyUid,
        seriesUid: req.params.seriesUid,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      return res.status(response.status).json({ error: body })
    }

    const result = await response.json()
    res.json(result)
  } catch (err) {
    console.error('Failed to trigger processing from DB:', err)
    res.status(502).json({ error: 'DICOM processing service unavailable.' })
  }
})

export { router as studiesRouter }
