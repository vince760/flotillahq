# syntax=docker/dockerfile:1

# Node 22+ is required: the server uses the built-in node:sqlite driver, which
# is why there is no native module to compile here.
FROM node:24-slim AS build
WORKDIR /app

# Install with dev dependencies so TypeScript and Vite can run.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies from the tree we ship.
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The app listens on all interfaces inside the container; the platform's proxy
# terminates TLS in front of it.
ENV HOST=0.0.0.0
ENV PORT=10000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# The public pages (/about, /privacy, /terms). Google's OAuth reviewer opens
# these signed out — without them the image builds fine and fails verification.
COPY --from=build /app/site ./site

# data/ holds the SQLite database. Mount a persistent volume here or a redeploy
# takes every user's stored connection with it.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
