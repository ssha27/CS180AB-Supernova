import pg from 'pg'

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'dicom',
  ...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}),
  database: process.env.PG_DATABASE || 'dicom_meta',
  max: 10,
})

export function query(text, params) {
  return pool.query(text, params)
}

export default pool
