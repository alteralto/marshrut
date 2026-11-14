FROM node:22-bookworm-slim

# poppler reads PDF text and renders scanned pages, tesseract recognises them
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY rag ./rag
COPY app ./app
COPY corpus/case ./corpus/case
COPY corpus/text/mipt-*.txt ./corpus/text/
COPY corpus/extracted ./corpus/extracted
COPY notes/mockup/graphite.css notes/mockup/graphite.js ./notes/mockup/
COPY notes/asset-library ./notes/asset-library

# Read the bundled documents once, scans included, so the first start is instant.
RUN node app/server.js --prepare \
    && rm -rf /tmp/rag-ocr-cache \
    && mkdir -p /app/corpus/.cache /data \
    && chown -R node:node /app/corpus/.cache \
    && chown node:node /data && chmod 700 /data

ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data RAG_OCR_CACHE=/data/ocr-cache
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app/server.js"]
