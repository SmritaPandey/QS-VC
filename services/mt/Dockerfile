# QS-VC translation service (IndicTrans2). CPU by default; for NVIDIA GPUs build with
#   docker build --build-arg BASE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 ...
ARG BASE=python:3.11-slim
FROM ${BASE}
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
RUN if ! command -v python3 >/dev/null; then apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*; fi \
 && (command -v python >/dev/null || ln -s "$(command -v python3)" /usr/local/bin/python)
WORKDIR /app
COPY requirements.txt .
RUN python -m pip install -r requirements.txt
COPY app.py glossary.example.json ./
RUN useradd --system --uid 10001 qsvc && mkdir -p /models && chown qsvc /models
USER qsvc
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,json,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:5000/health'))['ok'] else 1)"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
