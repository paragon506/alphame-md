FROM node:22-bookworm-slim
ENV PORT=3000 WORK_DIR=/tmp/alphame
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 python3-pip python3-venv \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && pip3 install --no-cache-dir --break-system-packages spotifyscraper \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run check && npm prune --omit=dev && chown -R node:node /app
ENV NODE_ENV=production
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
