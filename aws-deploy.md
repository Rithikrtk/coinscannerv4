# AWS Deployment Guide

## Overview
This repository is a Flask app that can run on AWS as a dynamic web application. It supports both local SQLite development and production PostgreSQL via `DATABASE_URL`.

## Recommended AWS setup

### 1. Choose a deployment service
- **AWS Elastic Beanstalk** — easiest managed option for Python + Gunicorn.
- **AWS App Runner** — good for containerless deployments.
- **AWS ECS / Fargate** — recommended if you want container orchestration.
- **AWS EC2** — least managed, use only if you need custom instance control.

### 2. Use PostgreSQL in production
For production, configure an RDS PostgreSQL instance and set:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME
```

Example:

```env
DATABASE_URL=postgresql://coinscan_user:StrongP@ssw0rd@coinscanner-db.cxabc123.us-east-1.rds.amazonaws.com:5432/coinscanner
```

Do not rely on local SQLite for production on AWS.

## Initialize the database schema
Because `init_db()` is only called automatically when you run `python3 application.py`, create the tables at least once after provisioning the database. You can do this by:

1. Setting `DATABASE_URL` locally or in a one-off AWS shell.
2. Running:

```bash
python3 application.py
```

3. Stopping the script once the database tables are created.

Alternatively, run a one-off Python command in the same environment:

```bash
python3 -c "from application import init_db; init_db()"
```

## Update startup command
The app entrypoint is `application.py` and the Flask app object is `app`, so the startup command must be:

```bash
gunicorn app:app --workers 1 --timeout 120 --bind 0.0.0.0:$PORT
```

This repository already includes a `Procfile` with that command.

## Required environment variables
Set these values in your AWS environment:

- `SECRET_KEY` — a long random string
- `FLASK_ENV=production`
- `SESSION_COOKIE_SECURE=true`
- `DATABASE_URL` — PostgreSQL connection string for RDS/Aurora
- `NEWS_API_KEY`
- `RESEND_API_KEY` to enable email OTP delivery via Resend
- `MSG91_API_KEY` to enable SMS OTP delivery via MSG91
- `MSG91_SENDER_ID` if using MSG91 (optional; defaults to MSGIND)
- `MSG91_WIDGET_ID` if using MSG91 client-side verification
- `MSG91_TOKEN_AUTH` if using MSG91 client-side verification

Optional for CoinDCX authenticated endpoints:
- `COINDCX_API_KEY`
- `COINDCX_SECRET`

## Elastic Beanstalk quick start

1. Install EB CLI:
   ```bash
   pip install awsebcli
   ```
2. Initialize the project:
   ```bash
   eb init
   ```
3. Create an environment:
   ```bash
   eb create coin-scanner-env
   ```
4. Set environment variables:
   ```bash
   eb setenv SECRET_KEY=... FLASK_ENV=production SESSION_COOKIE_SECURE=true DATABASE_URL=... NEWS_API_KEY=...
   ```
5. Deploy:
   ```bash
   eb deploy
   ```

## Notes
- The app uses `ProxyFix` to support AWS load balancer headers for HTTPS.
- If you use SES, verify `AWS_SES_FROM_EMAIL` in the target AWS region before sending email.
- If you use MSG91, set `MSG91_API_KEY`, `MSG91_SENDER_ID`, `MSG91_WIDGET_ID`, and `MSG91_TOKEN_AUTH` as needed.
- For local testing, run:
  ```bash
  python3 application.py
  ```
