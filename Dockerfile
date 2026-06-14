# Single-service image: the Node server runs the API + scheduler AND serves the
# Goal Oracle front-end (same origin). Works on Railway, Fly.io, Render (Docker),
# Cloud Run, or any container host.
FROM node:22-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy the rest (server source + the goal-oracle front-end it serves)
COPY . .

ENV NODE_ENV=production \
    SPORT=football \
    PROVIDER=mock \
    SMS_PROVIDER=mock \
    PORT=3002

EXPOSE 3002
WORKDIR /app/server
CMD ["node", "src/server.js"]
