#!/usr/bin/env bash
set -e
cd /home/user/tienda_whatsapp
python3 -c "import fastapi, uvicorn, multipart" 2>/dev/null || pip install -q -r requirements.txt
exec python3 -m uvicorn app:app --host 0.0.0.0 --port 3000
