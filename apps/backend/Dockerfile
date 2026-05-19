FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

WORKDIR /app/apps/backend

COPY apps/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/backend ./

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
