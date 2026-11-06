# QS-VC speech recognition service (faster-whisper). CPU by default (model "small").
# NVIDIA GPU (recommended for live captions, model large-v3-turbo):
#   docker build --build-arg BASE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 -t qsvc-asr:gpu services/asr
#   add --build-arg ONNX_RUNTIME=onnxruntime-gpu==1.20.1 so IndicConformer also uses the GPU.
# INDIC=0 builds a smaller Whisper-only image.
ARG BASE=python:3.11-slim
FROM ${BASE}
ARG INDIC=1
ARG ONNX_RUNTIME=onnxruntime==1.20.1
# IndicConformer runs through ONNX Runtime; PyTorch is only used to pass audio, so the small CPU build is enough.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models ASR_MODEL_DIR=/models/whisper
RUN if ! command -v python3 >/dev/null; then apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*; fi \
 && (command -v python >/dev/null || ln -s "$(command -v python3)" /usr/local/bin/python)
WORKDIR /app
COPY requirements.txt requirements-indic.txt ./
RUN python -m pip install -r requirements.txt \
 && if [ "$INDIC" = "1" ]; then \
      python -m pip install --index-url "$TORCH_INDEX" torch==2.5.1 torchaudio==2.5.1 \
      && python -m pip install -r requirements-indic.txt "$ONNX_RUNTIME"; fi
COPY app.py .
RUN useradd --system --uid 10001 qsvc && mkdir -p /models/whisper && chown -R qsvc /models
USER qsvc
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,json,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:8000/health'))['ok'] else 1)"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--ws-max-size", "131072"]
