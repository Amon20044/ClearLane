FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
# bundled artifacts so the API serves even without the raw dataset
COPY frontend/public/demo /app/demo_artifacts
ENV CLEARLANE_ARTIFACTS=/app/demo_artifacts
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
