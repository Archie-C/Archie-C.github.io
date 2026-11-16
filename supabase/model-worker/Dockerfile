FROM python:3.11-slim
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 \
    && pip install --no-cache-dir safetensors==0.4.5
COPY sandbox.py /opt/worker/sandbox.py
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python", "-I", "-u", "/opt/worker/sandbox.py"]
