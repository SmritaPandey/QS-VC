# QS-VC translation service (IndicTrans2). CPU by default (small CPU-only PyTorch, ~0.2 GB instead of ~2.5 GB).
# GPU builds require a version-matched CUDA BASE and TORCH_INDEX; validate on target hardware.
ARG BASE=python:3.11-slim
FROM ${BASE}
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
RUN if ! command -v python3 >/dev/null; then apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*; fi \
 && (command -v python >/dev/null || ln -s "$(command -v python3)" /usr/local/bin/python)
WORKDIR /app
ENV NODE_ENV=production
COPY shared/model_security.py ./shared/model_security.py
COPY services/mt/requirements.txt .
# PyTorch first, from the chosen index (CPU or CUDA build); the pinned requirement then counts as satisfied.
RUN python -m pip install --index-url "$TORCH_INDEX" torch==2.15.0 \
 && python -m pip install -r requirements.txt
COPY services/mt/app.py services/mt/glossary.example.json ./
RUN useradd --system --uid 10001 qsvc && mkdir -p /models && chown qsvc /models
USER qsvc
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,json,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:5000/health'))['ok'] else 1)"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1"]
