# Database + Ingestion Setup

This portion uses:

* **PostgreSQL** for storing DICOM metadata
* **MongoDB (GridFS)** for storing the actual DICOM files
* **Docker Compose** to run the databases locally
* A **Python virtual environment (venv)** for running ingestion scripts

---

# Prerequisites

Install the following tools:

* Docker
* Docker Compose
* Python 3.10+

Verify installation:

```bash
docker --version
docker compose version
python3 --version
```

---

# Quick Start

## 1. Start the databases

From the root of the repository:

```bash
docker compose up -d
```

This will start the PostgreSQL and MongoDB containers.

---

## 2. Confirm containers are running

```bash
docker compose ps
```

You should see containers for:

* `postgres`
* `mongo`

with a **running** status.

---

## 3. Initialize the PostgreSQL schema

Run:

```bash
docker compose exec postgres psql -U postgres -d dicomdb -f /docker-entrypoint-initdb.d/init.sql
```

This creates the metadata table:

```
dicom_instances
```

---

## 4. Create a Python virtual environment

From the project root:

```bash
python3 -m venv .venv
```

Activate the environment.

### Mac/Linux

```bash
source .venv/bin/activate
```

### Windows (PowerShell)

```powershell
.\.venv\Scripts\activate
```

---

## 5. Install Python dependencies

Once the virtual environment is activated:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 6. Run the ingestion script

Example:

```bash
python ingest.py --help
```

Typical usage might look like:

```bash
python ingest.py --input ./dicom_files
```

The ingestion script will:

1. Parse metadata from each DICOM file
2. Upload the file to **MongoDB GridFS**
3. Store metadata and a pointer to the Mongo file in **PostgreSQL**

---

# Project Architecture

## PostgreSQL (Metadata Database)

PostgreSQL stores structured metadata about each DICOM instance.

Example fields stored in the table:

* `study_instance_uid`
* `series_instance_uid`
* `sop_instance_uid`
* `patient_id`
* `modality`
* `study_date`
* `mongo_file_id`
* `upload_status`
* `byte_length`
* `sha256`
* `filename`
* `created_at`

These fields allow fast searching and indexing of imaging metadata.

---

## MongoDB (File Storage)

MongoDB stores the **actual DICOM files** using **GridFS**.

GridFS stores files across two collections:

```
dicom.files
dicom.chunks
```

### dicom.files

Stores metadata for each file including:

* file id
* upload date
* chunk size
* number of chunks

### dicom.chunks

Stores the binary data of the files split into chunks.

Each chunk contains:

* file id reference
* chunk number
* binary data

The PostgreSQL table stores the `mongo_file_id`, which links metadata to the corresponding GridFS file.


---

# Useful Docker Commands

## Start containers

```bash
docker compose up -d
```

---

## Stop containers

```bash
docker compose down
```

---

## View logs

```bash
docker compose logs -f
```

View logs for a specific service:

```bash
docker compose logs -f postgres
docker compose logs -f mongo
```

---


# Typical Repository Structure

```
project-root/
│
├── docker-compose.yml
├── init.sql
├── ingest.py
├── requirements.txt
├── README.md
│
├── dicom_files/
│
└── .venv/
```
