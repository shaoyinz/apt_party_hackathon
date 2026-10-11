FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl \
    libgl1 libglib2.0-0 libsm6 libice6 libxext6 libx11-6 libxcb1 zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && uv sync --frozen
ENV NODE_ENV=production
ENV ROOST_STRICT_HEALTH=true
ENV ROOST_DATA_DIR=/data
EXPOSE 8080
RUN chmod +x scripts/docker-entrypoint.sh
CMD ["scripts/docker-entrypoint.sh"]
