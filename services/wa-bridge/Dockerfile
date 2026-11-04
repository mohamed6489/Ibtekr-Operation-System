# wa-bridge (phase 6.4) — WhatsApp 1 / 2 by QR. The sessions live in /data (mount a private volume); no database key in here.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
ENV WA_DATA=/data NODE_ENV=production
CMD ["node", "src/main.js"]
